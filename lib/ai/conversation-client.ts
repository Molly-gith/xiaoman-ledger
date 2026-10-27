import { readLimitedJson } from "./question-request.ts";
import { validateAssistantDraft } from "./assistant-contract.ts";
import { validateQueryPlan } from "../domain/ledger-query.ts";
import { validateConversationRequest, validatePreferenceProposal, type ConversationRequest, type ConversationResult } from "./conversation-contract.ts";

export async function converse(input: ConversationRequest & { endpoint: string; signal?: AbortSignal }, options: { fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<ConversationResult> {
  const { endpoint, signal, ...body } = input;
  const unavailable = (reason: string): ConversationResult => ({ status: "unavailable", reason, originalText: body.text });
  if (!validateConversationRequest(body)) return unavailable("输入或对话上下文需要核对，请重新打开对话后再试。");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = new URL(endpoint);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !/^\/api\/ai\/(?:question|assistant)$/.test(url.pathname)) throw new Error("Invalid endpoint");
    url.pathname = "/api/ai/assistant";
    const run = async (): Promise<ConversationResult> => {
      if (controller.signal.aborted) throw new Error("Aborted");
      const response = await (options.fetchFn ?? fetch)(url.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error" });
      if (response.status === 429) return unavailable("这一会儿请求有些多，请稍后再试，文字已保留。常用日期查账仍可直接使用。");
      if (!response.ok) return unavailable("小满暂时没能处理，文字已保留，请稍后重试。");
      const value = await readLimitedJson(response, 16384);
      if (!value || typeof value !== "object" || !("status" in value)) throw new Error("Invalid response");
      const v = value as ConversationResult;
      const only = (...keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
      if (v.status === "query" && only("status", "plan") && validateQueryPlan(v.plan)) return v;
      if (v.status === "preference" && only("status", "preference") && validatePreferenceProposal(v.preference)) return v;
      if (v.status === "transactions" && only("status", "drafts", "modelVersion", "workflowVersion") && Array.isArray(v.drafts) && v.drafts.length > 0 && v.drafts.length <= 5 && v.drafts.every(d => validateAssistantDraft(d, body.context.today) && !d.ambiguous)
        && typeof v.modelVersion === "string" && !!v.modelVersion && v.modelVersion.length <= 200 && typeof v.workflowVersion === "string" && !!v.workflowVersion && v.workflowVersion.length <= 200) return v;
      if (v.status === "clarification" && only("status", "question") && typeof v.question === "string" && !!v.question.trim() && v.question.length <= 300) return v;
      if (v.status === "answer" && only("status", "answer", "nextActions") && typeof v.answer === "string" && !!v.answer.trim() && v.answer.length <= 1200 && Array.isArray(v.nextActions) && !v.nextActions.length) return v;
      throw new Error("Invalid response");
    };
    return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Timeout")); }, options.timeoutMs ?? 30000); })]);
  } catch { return unavailable(signal?.aborted ? "已取消，文字保留。" : "这次没有取得可靠结果，请稍后重试。文字已保留。"); }
  finally { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
