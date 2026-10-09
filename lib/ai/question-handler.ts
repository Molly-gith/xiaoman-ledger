import { createAIAdapter } from "./adapter.ts";
import { createDifyProvider } from "./dify-provider.ts";
import { readLimitedJson, validateQuestionRequest } from "./question-request.ts";

export interface AIEnv {
  AI_ALLOWED_ORIGINS: string;
  AI_BETA_TOKEN: string;
  DIFY_API_KEY: string;
  DIFY_MODEL_VERSION: string;
  DIFY_WORKFLOW_VERSION: string;
}
export type QuestionDependencies = { checkLimit: () => Promise<{ rateLimited: boolean; error?: string }>; fetchFn?: typeof fetch; timeoutMs?: number };

const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
async function tokenMatches(supplied: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([hash(supplied), hash(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Private preview only. No ledger/storage bindings and no write operations. */
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
  // CORS is not authentication. All required secrets and limiters fail closed.
  if (!env.AI_BETA_TOKEN || !/^[A-Za-z0-9_-]{32,128}$/.test(env.AI_BETA_TOKEN)
    || !env.DIFY_API_KEY?.trim() || !env.DIFY_MODEL_VERSION?.trim() || !env.DIFY_WORKFLOW_VERSION?.trim()
    || !dependencies.checkLimit) return result(503, "not_configured");
  try {
    const authorization = request.headers.get("Authorization") ?? "";
    if (authorization.length > 140 || !authorization.startsWith("Bearer ")
      || !await tokenMatches(authorization.slice(7), env.AI_BETA_TOKEN)) return result(401, "unauthorized");
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
      userId: "xiaoman-private-beta", fetchFn: dependencies.fetchFn,
    }), { timeoutMs: dependencies.timeoutMs ?? 25000 });
    const answer = await adapter.answerFinancialQuestion({ question: body.question.trim(), snapshot: body.snapshot }, body.context);
    if (answer.status !== "suggestion") return result(502, answer.reason === "invalid_output" ? "invalid_output" : "unavailable");
    return new Response(JSON.stringify(answer), { status: 200, headers });
  } catch {
    // Never log/return raw request, provider errors, token or financial values.
    return result(503, "unavailable");
  }
}
