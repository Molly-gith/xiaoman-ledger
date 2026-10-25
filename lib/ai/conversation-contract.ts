import type { TransactionDraft } from "./adapter.ts";
import { validateAssistantDraft } from "./assistant-contract.ts";
import { validateQueryPlan, type QueryPlan } from "../domain/ledger-query.ts";
import type { DateRange } from "../domain/date-range.ts";
import type { ExpenseNature, LedgerKind } from "../domain/types.ts";

export type PreferenceProposal = { keyword: string; category: string | null; nature: ExpenseNature | null };
export type ConversationRequest = {
  protocolVersion: 2; text: string; context: { today: string; timezone: string };
  ledgerKind: LedgerKind; defaultRange: DateRange;
  memory: { recentMessages: { role: "user" | "assistant"; content: string }[]; previousQuery?: QueryPlan };
  clarification?: { originalText: string; question: string; answer: string };
};
export type ConversationOutput = {
  intent: "transactions" | "query" | "preference" | "clarification" | "question";
  transactions: TransactionDraft[]; query: QueryPlan | null; preference: PreferenceProposal | null;
  answer: string; clarification: string; confidence: number;
};
export type ConversationResult =
  | { status: "transactions"; drafts: TransactionDraft[]; modelVersion: string; workflowVersion: string }
  | { status: "query"; plan: QueryPlan }
  | { status: "preference"; preference: PreferenceProposal }
  | { status: "answer"; answer: string; nextActions: string[] }
  | { status: "clarification"; question: string }
  | { status: "unavailable"; reason: string; originalText: string };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => k in v) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const txt = (v: unknown, max: number, empty = false): v is string => typeof v === "string" && v.length <= max && (empty || v.trim().length > 0);
const day = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "1900-01-01" && v <= "9998-12-31" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const range = (v: unknown): v is DateRange => record(v) && keys(v, ["startDate", "endDate"]) && day(v.startDate) && day(v.endDate) && v.startDate <= v.endDate;
export function validatePreferenceProposal(v: unknown): v is PreferenceProposal {
  return record(v) && keys(v, ["keyword", "category", "nature"]) && txt(v.keyword, 40) && v.keyword.trim().length >= 2
    && (v.category === null || ["餐饮", "购物", "交通", "居住", "健康", "医疗", "学习", "娱乐", "其他"].includes(v.category as string))
    && (v.nature === null || ["消费", "浪费", "投资"].includes(v.nature as string)) && (v.category !== null || v.nature !== null);
}
export function validateConversationRequest(v: unknown): v is ConversationRequest {
  if (!record(v) || !keys(v, ["protocolVersion", "text", "context", "ledgerKind", "defaultRange", "memory"], ["clarification"])
    || v.protocolVersion !== 2 || !txt(v.text, 1000) || !["personal", "family", "travel"].includes(v.ledgerKind as string)
    || !record(v.context) || !keys(v.context, ["today", "timezone"]) || !day(v.context.today) || !txt(v.context.timezone, 64) || !range(v.defaultRange)
    || !record(v.memory) || !keys(v.memory, ["recentMessages"], ["previousQuery"]) || !Array.isArray(v.memory.recentMessages) || v.memory.recentMessages.length > 8
    || !v.memory.recentMessages.every(m => record(m) && keys(m, ["role", "content"]) && ["user", "assistant"].includes(m.role as string) && txt(m.content, 1000))
    || (v.memory.previousQuery !== undefined && !validateQueryPlan(v.memory.previousQuery))) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: v.context.timezone }); } catch { return false; }
  return v.clarification === undefined || (record(v.clarification) && keys(v.clarification, ["originalText", "question", "answer"])
    && txt(v.clarification.originalText, 2000) && txt(v.clarification.question, 300) && v.clarification.answer === v.text);
}
export function validateConversationOutput(v: unknown, today: string): v is ConversationOutput {
  if (!record(v) || !keys(v, ["intent", "transactions", "query", "preference", "answer", "clarification", "confidence"])
    || !Array.isArray(v.transactions) || v.transactions.length > 5 || !v.transactions.every(d => validateAssistantDraft(d, today) && !d.ambiguous)
    || !txt(v.answer, 1200, true) || !txt(v.clarification, 300, true) || typeof v.confidence !== "number" || !Number.isFinite(v.confidence) || v.confidence < 0 || v.confidence > 1) return false;
  const noText = v.answer === "" && v.clarification === "";
  if (v.intent === "transactions") return v.transactions.length > 0 && v.query === null && v.preference === null && noText;
  if (v.intent === "query") return !v.transactions.length && validateQueryPlan(v.query) && v.preference === null && noText;
  if (v.intent === "preference") return !v.transactions.length && v.query === null && validatePreferenceProposal(v.preference) && noText;
  if (v.intent === "clarification") return !v.transactions.length && v.query === null && v.preference === null && v.answer === "" && !!v.clarification.trim();
  return v.intent === "question" && !v.transactions.length && v.query === null && v.preference === null && v.clarification === "" && !!v.answer.trim();
}

function explicitOwnTransfer(text: string): boolean {
  const normalized = text.normalize("NFKC").replace(/\s+/g, "");
  if (/(?:不是|并非|不属于)[^，,。；;]{0,12}(?:自己|自有|本人)[^，,。；;]{0,16}(?:转账|划转)/.test(normalized)
    || /是否|是不是|假如|如果|假设|吗[?？。]?$/.test(normalized)) return false;
  const account = "(?:我自己的|自己的|本人的|我的|本人|我|自己)(?:(?:另一|另外一|两)张)?(?:银行账户|银行卡|储蓄卡|工资卡|卡|账户|账号|微信钱包|微信|支付宝|钱包)";
  return new RegExp(`从${account}(?:里|中)?转来(?:了)?(?:人民币)?[¥￥]?\\d+(?:\\.\\d{1,2})?(?:元|块)?(?=$|[，,。；;！!])`).test(normalized)
    || new RegExp(`${account}[^，,。；;]{0,30}(?:转|划)[^，,。；;]{0,30}${account}`).test(normalized)
    || /(?:我|本人|自己|自有)(?:的)?(?:两(?:个|张)|不同)?(?:银行账户|账户|账号|银行卡|卡)(?:之)?间[^，,。；;]{0,8}(?:转账|划转|转钱)/.test(normalized);
}

function ownTransferResult(request: ConversationRequest): ConversationResult | null {
  // Only the current statement (or a short reply to its active clarification)
  // may establish this scope. Unrelated conversation history is never evidence.
  const shortReply = /^(?:是的?|对的?|没错|嗯|确认|(?:人民币|[¥￥])?\d+(?:\.\d{1,2})?(?:元|块)?)[。.!！]?$/;
  const current = request.text.trim();
  const source = explicitOwnTransfer(current) ? current
    : request.clarification && shortReply.test(current) && explicitOwnTransfer(request.clarification.originalText) ? request.clarification.originalText : null;
  if (!source) return null;
  // Do not silently drop other events in a mixed request or save a partial batch.
  const withoutDates = source.replace(/\d{4}-\d{2}-\d{2}|(?:\d{4}年)?\d{1,2}月\d{1,2}(?:日|号)/g, "");
  if ((withoutDates.match(/\d+(?:\.\d+)?(?:元|块)?/g)?.length ?? 0) > 1) return {
    status: "clarification",
    question: "自己账户之间的转账不属于新增收入或支出，当前小满不支持单独记录转账。如果这段话还包含实际收入或支出，请把要记的部分单独说明。",
  };
  return { status: "answer", answer: "自己账户之间的资金移动不属于新增收入或支出。当前小满不支持单独记录转账，这笔不会生成记账草稿。", nextActions: [] };
}

export function conversationResult(v: ConversationOutput, request: ConversationRequest, versions: { modelVersion: string; workflowVersion: string }): ConversationResult {
  const transfer = ownTransferResult(request);
  if (transfer) return transfer;
  if (v.intent === "query") return { status: "query", plan: v.query! };
  if (v.intent === "preference") return { status: "preference", preference: v.preference! };
  if (v.intent === "clarification") return { status: "clarification", question: v.clarification };
  if (v.intent === "transactions") {
    const input = `${request.clarification?.originalText ?? ""}\n${request.text}`;
    const explicitWaste = /浪费|没必要|不该买|后悔|冲动消费|乱花|waste/i.test(input) && !/(?:不|没|非|无).{0,3}浪费/.test(input);
    return { status: "transactions", ...versions, drafts: v.transactions.map(d => ({ ...d, nature_suggestion: d.type === "income" ? null : d.nature_suggestion === null || (d.nature_suggestion === "浪费" && !explicitWaste) ? "消费" : d.nature_suggestion })) };
  }
  // Product help comes from the product contract. Model prose is never proof
  // that a record was saved or a balance was checked.
  const help = /记忆|记住|偏好|分类/.test(request.text)
    ? "你可以告诉我“以后健身课算投资”，确认后用于这个账本的新草稿。可在“记忆与偏好”查看、修改或清除；保存位置以“我的”中的当前模式为准。"
    : "我可以帮你按日期、分类和账本查询真实记录，也可以整理待保存的账目。比如问“上个月餐饮花了多少”，再问“跟前一个月比呢”；记账草稿需要你确认保存后才会写入账本。";
  return { status: "answer", answer: help, nextActions: [] };
}
