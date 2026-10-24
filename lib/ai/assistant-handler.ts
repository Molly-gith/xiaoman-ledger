import { createDifyProvider } from "./dify-provider.ts";
import { reportFacts, toAssistantResult, validateAssistantRequest, validateWorkflowOutput } from "./assistant-contract.ts";
import { readLimitedJson } from "./question-request.ts";
import type { AIEnv, QuestionDependencies } from "./question-handler.ts";

/** Anonymous draft/answer endpoint. It never receives a ledger store or writes records. */
export async function handleAssistantRequest(request: Request, env: AIEnv, dependencies: QuestionDependencies): Promise<Response> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.AI_ALLOWED_ORIGINS ?? "").split(",").map(item => item.trim()).filter(Boolean);
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" };
  const result = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers });
  if (new URL(request.url).pathname !== "/api/ai/assistant") return result(404, "not_found");
  if (!origin || !allowed.includes(origin) || origin === "null" || origin === "*") return result(403, "origin_denied");
  headers["Access-Control-Allow-Origin"] = origin;
  if (request.method === "OPTIONS") {
    headers["Access-Control-Allow-Methods"] = "POST";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return result(405, "method_not_allowed");
  // Origin checks reduce accidental cross-site use; the trusted-IP limiter is
  // enforced before inference and remains mandatory for this anonymous API.
  if (!env.DIFY_API_KEY?.trim() || !env.DIFY_MODEL_VERSION?.trim() || !env.DIFY_WORKFLOW_VERSION?.trim() || !dependencies.checkLimit) return result(503, "not_configured");
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")) return result(415, "invalid_content_type");
  let body: unknown;
  try { body = await readLimitedJson(request, 16384); } catch { return result(400, "invalid_request"); }
  if (!validateAssistantRequest(body)) return result(400, "invalid_request");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = await dependencies.checkLimit();
    if (limit.error) return result(503, "unavailable");
    if (limit.rateLimited) { headers["Retry-After"] = "60"; return result(429, "rate_limited"); }
    const provider = createDifyProvider({ baseUrl: "https://api.dify.ai", apiKey: env.DIFY_API_KEY,
      modelVersion: env.DIFY_MODEL_VERSION, workflowVersion: env.DIFY_WORKFLOW_VERSION, userId: "xiaoman-assistant", fetchFn: dependencies.fetchFn });
    const payload = { text: body.text.trim(), ...(body.report ? { report: body.report } : {}),
      ...(body.clarification ? { clarification: body.clarification } : {}), referencedFacts: reportFacts(body.report) };
    const value = await Promise.race([provider.generate("assistLedger", payload, body.context, controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Deadline")); }, dependencies.timeoutMs ?? 25000);
    })]);
    if (!validateWorkflowOutput(value, body)) return result(502, "invalid_output");
    return new Response(JSON.stringify(toAssistantResult(value, body, { modelVersion: env.DIFY_MODEL_VERSION, workflowVersion: env.DIFY_WORKFLOW_VERSION })), { status: 200, headers });
  } catch { return result(503, "unavailable"); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
