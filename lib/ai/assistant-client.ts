import { validateAssistantDraft, validateAssistantRequest, type AssistantRequest, type AssistantResult } from "./assistant-contract.ts";
import { readLimitedJson } from "./question-request.ts";
export type { AssistantResult, DeterministicReport, ClarificationContext } from "./assistant-contract.ts";

type ClientInput = AssistantRequest & { endpoint: string; signal?: AbortSignal };

/** Public endpoint only: no model key or beta credential is accepted by this client. */
export async function assistLedger(input: ClientInput, options: { fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<AssistantResult> {
  const { endpoint, signal, ...body } = input;
  const unavailable = (reason: string): AssistantResult => ({ status: "unavailable", reason, originalText: input.text });
  if (!validateAssistantRequest(body)) return unavailable("输入或统计范围需要核对，请检查后重试。");
  if (signal?.aborted) return unavailable("已取消这次处理，文字已保留。");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid endpoint");
    if (url.username || url.password || url.search || url.hash || !/^\/api\/ai\/(?:question|assistant)$/.test(url.pathname)) throw new Error("Invalid endpoint");
    url.pathname = "/api/ai/assistant";
    const operation = async (): Promise<AssistantResult> => {
      const response = await (options.fetchFn ?? fetch)(url.href, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error" });
      if (response.status === 429) return unavailable("这一会儿请求有些多，请稍后再试，文字已保留。");
      if (!response.ok) return unavailable("小满暂时没能处理，文字已保留，可以稍后重试或手动记账。");
      const value = await readLimitedJson(response, 16384);
      if (typeof value !== "object" || value === null || !("status" in value)) throw new Error("Invalid response");
      const result = value as AssistantResult;
      const only = (keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
      if (result.status === "transactions" && Array.isArray(result.drafts) && result.drafts.length > 0 && result.drafts.length <= 5
        && only(["status", "drafts", "modelVersion", "workflowVersion"])
        && result.drafts.every(draft => validateAssistantDraft(draft, body.context.today) && !draft.ambiguous)
        && typeof result.modelVersion === "string" && result.modelVersion.length > 0 && result.modelVersion.length <= 200
        && typeof result.workflowVersion === "string" && result.workflowVersion.length > 0 && result.workflowVersion.length <= 200) return result;
      if (result.status === "answer" && typeof result.answer === "string" && result.answer.trim() && result.answer.length <= 1200
        && only(["status", "answer", "nextActions"])
        && Array.isArray(result.nextActions) && result.nextActions.length <= 3 && result.nextActions.every(item => typeof item === "string" && item.length <= 300)) return result;
      if (result.status === "clarification" && only(["status", "question"]) && typeof result.question === "string" && result.question.trim() && result.question.length <= 300) return result;
      throw new Error("Invalid response");
    };
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Deadline")); }, options.timeoutMs ?? 30000);
    })]);
  } catch { return unavailable(signal?.aborted ? "已取消这次处理，文字已保留。" : "这次没有取得可靠结果，文字已保留，请稍后重试或手动记账。"); }
  finally { if (timer !== undefined) clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}
