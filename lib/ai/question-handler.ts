import { createAIAdapter } from "./adapter.ts";
import { createDifyProvider } from "./dify-provider.ts";
import { readLimitedJson, validateQuestionRequest } from "./question-request.ts";

export interface AIEnv {
  AI_ALLOWED_ORIGINS: string;
  DIFY_API_KEY: string;
  DIFY_MODEL_VERSION: string;
  DIFY_WORKFLOW_VERSION: string;
}
export type QuestionDependencies = { checkLimit: () => Promise<{ rateLimited: boolean; error?: string }>; fetchFn?: typeof fetch; timeoutMs?: number };

/** Compatibility question endpoint. No ledger/storage bindings or write operations. */
export async function handleAIRequest(request: Request, env: AIEnv, dependencies: QuestionDependencies): Promise<Response> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.AI_ALLOWED_ORIGINS ?? "").split(",").map(item => item.trim()).filter(Boolean);
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" };
  const result = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers });
  if (new URL(request.url).pathname !== "/api/ai/question") return result(404, "not_found");
  if (!origin || !allowed.includes(origin) || origin === "null" || origin === "*") return result(403, "origin_denied");
  headers["Access-Control-Allow-Origin"] = origin;
  if (request.method === "OPTIONS") {
    headers["Access-Control-Allow-Methods"] = "POST";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "600";
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return result(405, "method_not_allowed");
  // Public anonymous access: provider secrets and the trusted-IP limiter fail closed.
  if (!env.DIFY_API_KEY?.trim() || !env.DIFY_MODEL_VERSION?.trim() || !env.DIFY_WORKFLOW_VERSION?.trim()
    || !dependencies.checkLimit) return result(503, "not_configured");
  try {
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")) return result(415, "invalid_content_type");
    let body: unknown;
    try { body = await readLimitedJson(request, 16384); } catch { return result(400, "invalid_request"); }
    if (!validateQuestionRequest(body)) return result(400, "invalid_request");
    const limit = await dependencies.checkLimit();
    if (limit.error) return result(503, "unavailable");
    if (limit.rateLimited) { headers["Retry-After"] = "60"; return result(429, "rate_limited"); }
    const adapter = createAIAdapter(createDifyProvider({
      baseUrl: "https://api.dify.ai", apiKey: env.DIFY_API_KEY,
      workflowVersion: env.DIFY_WORKFLOW_VERSION, modelVersion: env.DIFY_MODEL_VERSION,
      userId: "xiaoman-assistant", fetchFn: dependencies.fetchFn,
    }), { timeoutMs: dependencies.timeoutMs ?? 25000 });
    const answer = await adapter.answerFinancialQuestion({ question: body.question.trim(), snapshot: body.snapshot }, body.context);
    if (answer.status !== "suggestion") return result(502, answer.reason === "invalid_output" ? "invalid_output" : "unavailable");
    return new Response(JSON.stringify(answer), { status: 200, headers });
  } catch {
    // Never log/return raw request, provider errors, token or financial values.
    return result(503, "unavailable");
  }
}
