import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai/openai-compatible-provider.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { createOpenAICompatibleProvider } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const context = { today: "2026-09-17", timezone: "Asia/Shanghai" };

test("question provider sends user question plus snapshot and keeps safety boundary", async () => {
  let requestBody;
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://api.example.com/v1",
    apiKey: "server-secret",
    model: "model-v1",
    workflowVersion: "question-v1",
    fetchFn: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          answer: "当前没有足够依据判断财务阶段。",
          next_actions: [],
          referenced_facts: ["readiness:ready"],
          confidence: 0.9,
        }) } }],
      }), { status: 200 });
    },
  });

  const input = {
    question: "我属于哪个财务阶段？",
    snapshot: {
      referencedFacts: ["readiness:ready"],
      readiness: "ready",
    },
  };
  await provider.generate("answerFinancialQuestion", input, context, new AbortController().signal);

  const system = requestBody.messages[0].content;
  const user = JSON.parse(requestBody.messages[1].content);
  assert.match(system, /payload\.question/);
  assert.match(system, /payload\.snapshot/);
  assert.match(system, /不得自行发明阈值或阶段/);
  assert.match(system, /具体证券\/基金买卖推荐/);
  assert.deepEqual(user, { operation: "answerFinancialQuestion", payload: input, context });
});
