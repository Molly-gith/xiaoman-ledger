import { createAIAdapter } from '../lib/ai/adapter.ts';
import { createDifyProvider } from '../lib/ai/dify-provider.ts';
import { createOpenAICompatibleProvider } from '../lib/ai/openai-compatible-provider.ts';
import { assistantV03SeedCases } from './v0.3-assistant-cases.mjs';
import { runLiveQuestionEvaluation } from './live-question-runner.mjs';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required private runtime variable: ${name}`);
  return value;
}

function createProviderFromEnv() {
  const kind = process.env.XIAOMAN_AI_PROVIDER?.trim().toLowerCase();
  if (kind === 'openai-compatible' || kind === 'openai') {
    return createOpenAICompatibleProvider({
      baseUrl: requiredEnv('XIAOMAN_AI_BASE_URL'),
      apiKey: requiredEnv('XIAOMAN_AI_API_KEY'),
      model: requiredEnv('XIAOMAN_AI_MODEL'),
      modelVersion: process.env.XIAOMAN_AI_MODEL_VERSION?.trim() || undefined,
      workflowVersion: requiredEnv('XIAOMAN_AI_WORKFLOW_VERSION'),
    });
  }
  if (kind === 'dify') {
    return createDifyProvider({
      baseUrl: requiredEnv('XIAOMAN_DIFY_BASE_URL'),
      apiKey: requiredEnv('XIAOMAN_DIFY_API_KEY'),
      modelVersion: requiredEnv('XIAOMAN_DIFY_MODEL_VERSION'),
      workflowVersion: requiredEnv('XIAOMAN_DIFY_WORKFLOW_VERSION'),
      userId: process.env.XIAOMAN_DIFY_USER_ID?.trim() || 'xiaoman-live-eval',
    });
  }
  throw new Error('Set XIAOMAN_AI_PROVIDER=openai-compatible or dify in the private runtime.');
}

function parseLimit() {
  if (process.argv.includes('--full')) return assistantV03SeedCases.length;
  const arg = process.argv.find((item) => item.startsWith('--limit='));
  if (!arg) return 20;
  const value = Number.parseInt(arg.slice('--limit='.length), 10);
  if (!Number.isInteger(value) || value < 1) throw new Error('--limit must be a positive integer');
  return Math.min(value, assistantV03SeedCases.length);
}

try {
  const provider = createProviderFromEnv();
  const adapter = createAIAdapter(provider, {
    timeoutMs: Number.parseInt(process.env.XIAOMAN_AI_TIMEOUT_MS ?? '30000', 10),
  });
  const report = await runLiveQuestionEvaluation(adapter, assistantV03SeedCases, { limit: parseLimit() });
  process.stdout.write(`${JSON.stringify({
    generated_at: new Date().toISOString(),
    provider: process.env.XIAOMAN_AI_PROVIDER,
    model_version: provider.modelVersion,
    workflow_version: provider.workflowVersion,
    ...report,
  }, null, 2)}\n`);
  if (report.contract_failed > 0) process.exitCode = 1;
} catch (error) {
  // Fail closed. Never print provider responses, request headers, or secrets from thrown errors.
  const message = error instanceof Error ? error.message : 'Unknown live eval configuration error';
  process.stderr.write(`Live eval not run: ${message}\n`);
  process.exitCode = 2;
}
