import { validateFinancialQuestionAnswer, type FinancialQuestionAnswer, type AIResult } from "./adapter.ts";
import { readLimitedJson, validateQuestionRequest, type QuestionRequest } from "./question-request.ts";

export type QuestionClientResult = { ok: true; result: Extract<AIResult<FinancialQuestionAnswer>, { status: "suggestion" }> }
  | { ok: false; message: string; reauthorize?: boolean };

/** Only the short-lived beta access code enters the browser; never a Dify/model key. */
export async function askFinancialQuestion(endpoint: string, token: string, body: QuestionRequest, options: { signal?: AbortSignal; fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<QuestionClientResult> {
  if (!validateQuestionRequest(body)) return { ok: false, message: "账本摘要还需核对，请先检查本周期数据。" };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid endpoint");
    if (url.username || url.password || url.search || url.hash) throw new Error("Invalid endpoint");
    const operation = async (): Promise<QuestionClientResult> => {
      const response = await (options.fetchFn ?? fetch)(url.href, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body), signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error",
      });
      if (response.status === 401) return { ok: false, reauthorize: true, message: "体验码无效或已更新，请重新填写。" };
      if (response.status === 429) return { ok: false, message: "刚刚问得有些频繁，请一分钟后再试。" };
      if (!response.ok) return { ok: false, message: "小满暂时无法回答，你的问题已保留，可以稍后重试。" };
      const data = await readLimitedJson(response, 16384);
      if (typeof data !== "object" || data === null || !("status" in data) || data.status !== "suggestion"
        || !("value" in data) || !validateFinancialQuestionAnswer(data.value, body.snapshot)
        || !("modelVersion" in data) || typeof data.modelVersion !== "string"
        || !("workflowVersion" in data) || typeof data.workflowVersion !== "string") throw new Error("Invalid answer");
      return { ok: true, result: data as Extract<AIResult<FinancialQuestionAnswer>, { status: "suggestion" }> };
    };
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Deadline")); }, options.timeoutMs ?? 30000);
    })]);
  } catch {
    return { ok: false, message: "这次没有取得可靠回答。请检查网络后重试，记账仍可正常使用。" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
