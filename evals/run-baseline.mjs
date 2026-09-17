import { readFile } from "node:fs/promises";
import ts from "typescript";
import { baselineCases } from "./baseline-cases.mjs";
import { runEvaluation } from "./runner.mjs";

async function importTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

function missingConfig(required) {
  return required.filter((name) => !process.env[name]?.trim());
}

async function createLiveProvider() {
  const providerKind = (process.env.AI_PROVIDER || "dify").trim().toLowerCase();
  if (providerKind === "dify") {
    const required = ["DIFY_API_BASE", "DIFY_API_KEY", "DIFY_WORKFLOW_VERSION", "DIFY_MODEL_VERSION"];
    const missing = missingConfig(required);
    if (missing.length) return { providerKind, missing };
    const { createDifyProvider } = await importTypeScript("../lib/ai/dify-provider.ts");
    return {
      providerKind,
      provider: createDifyProvider({
        baseUrl: process.env.DIFY_API_BASE,
        apiKey: process.env.DIFY_API_KEY,
        workflowVersion: process.env.DIFY_WORKFLOW_VERSION,
        modelVersion: process.env.DIFY_MODEL_VERSION,
        userId: process.env.DIFY_USER_ID || "xiaoman-eval",
      }),
    };
  }

  if (providerKind === "openai-compatible") {
    const required = ["AI_API_BASE", "AI_API_KEY", "AI_MODEL", "AI_WORKFLOW_VERSION"];
    const missing = missingConfig(required);
    if (missing.length) return { providerKind, missing };
    const { createOpenAICompatibleProvider } = await importTypeScript("../lib/ai/openai-compatible-provider.ts");
    return {
      providerKind,
      provider: createOpenAICompatibleProvider({
        baseUrl: process.env.AI_API_BASE,
        apiKey: process.env.AI_API_KEY,
        model: process.env.AI_MODEL,
        workflowVersion: process.env.AI_WORKFLOW_VERSION,
        modelVersion: process.env.AI_MODEL_VERSION || process.env.AI_MODEL,
      }),
    };
  }

  return { providerKind, invalidProvider: true };
}

const live = await createLiveProvider();
if (live.invalidProvider) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "unsupported_live_provider",
    provider: live.providerKind,
    supported: ["dify", "openai-compatible"],
  }, null, 2));
  process.exitCode = 2;
} else if (live.missing?.length) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_live_provider_config",
    provider: live.providerKind,
    missing: live.missing,
    note: "No real-model baseline was run. Configure secrets in the server/CI environment; never commit them to the repository.",
  }, null, 2));
  process.exitCode = 2;
} else {
  const { createAIAdapter } = await importTypeScript("../lib/ai/adapter.ts");
  const adapter = createAIAdapter(live.provider, { timeoutMs: 15_000, lowConfidenceThreshold: 0.8 });
  const report = await runEvaluation(adapter, baselineCases);
  const summary = {
    status: "completed",
    provider: live.providerKind,
    dataset: "baseline-cases-v0.1",
    ...report,
  };
  console.log(JSON.stringify(summary, null, 2));

  // Baseline collection is observational. P0 failures make the command non-zero so they cannot be missed.
  if (report.p0 > 0) process.exitCode = 1;
}
