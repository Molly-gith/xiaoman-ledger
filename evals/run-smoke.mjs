import { readFile } from "node:fs/promises";
import ts from "typescript";
import { runEvaluation } from "./runner.mjs";
import { smokeCases } from "./smoke-fixtures.mjs";

const source = await readFile(new URL("../lib/ai/adapter.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { createAIAdapter } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const useFixtureProvider = process.argv.includes("--fixture-provider");
const provider = useFixtureProvider ? {
  modelVersion: "fixture-echo-not-a-model", workflowVersion: "smoke-v1",
  async generate(operation, input) {
    return smokeCases.find((item) => item.capability === operation && JSON.stringify(item.user_input) === JSON.stringify(input))?.expected_structured_output;
  },
} : undefined;
const report = await runEvaluation(createAIAdapter(provider), smokeCases);
console.log(JSON.stringify({ mode: useFixtureProvider ? "fixture-echo-harness-check" : "disabled-no-model-evaluated", ...report }, null, 2));
if (report.failed) process.exitCode = 1;
