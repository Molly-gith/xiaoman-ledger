import { validateTransactionDraft, type TransactionDraft } from "./adapter.ts";
import type { DateRangeSummary } from "../domain/date-range.ts";
import { guardedReportAnswer } from "./report-answer.ts";

export type DeterministicReport = DateRangeSummary;
export type ClarificationContext = { originalText: string; question: string; answer: string };
export type AssistantRequest = {
  text: string;
  context: { today: string; timezone: string };
  report?: DeterministicReport;
  clarification?: ClarificationContext;
};
export type AssistantResult =
  | { status: "transactions"; drafts: TransactionDraft[]; modelVersion: string; workflowVersion: string }
  | { status: "answer"; answer: string; nextActions: string[] }
  | { status: "clarification"; question: string }
  | { status: "unavailable"; reason: string; originalText: string };

export type AssistantWorkflowOutput = {
  intent: "transactions" | "question" | "clarification";
  transactions: TransactionDraft[];
  answer: string;
  next_actions: string[];
  referenced_facts: string[];
  clarification: string;
  confidence: number;
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
const text = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && value.length <= max && (empty || value.trim().length > 0);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 5000;
const money = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) <= Math.max(1e-6, Math.abs(value * 100) * Number.EPSILON);
const nonnegative = (value: unknown): value is number => money(value) && value >= 0;
const day = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "1900-01-01" && value <= "9998-12-31"
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validateReport(value: unknown): value is DeterministicReport {
  if (!record(value) || !exactKeys(value, ["range", "transactionCount", "incomeCount", "expenseCount", "income", "expense", "balance", "natureTotals", "pendingDateCount"])
    || !record(value.range) || !exactKeys(value.range, ["startDate", "endDate"]) || !day(value.range.startDate) || !day(value.range.endDate) || value.range.startDate > value.range.endDate
    || ![value.transactionCount, value.incomeCount, value.expenseCount, value.pendingDateCount].every(count)
    || !nonnegative(value.income) || !nonnegative(value.expense) || !money(value.balance)
    || !record(value.natureTotals) || !exactKeys(value.natureTotals, ["消费", "浪费", "投资", "未分类"]) || !Object.values(value.natureTotals).every(nonnegative)) return false;
  const report = value as DeterministicReport;
  return report.transactionCount === report.incomeCount + report.expenseCount && report.pendingDateCount <= report.transactionCount
    && Math.round(report.balance * 100) === Math.round(report.income * 100) - Math.round(report.expense * 100)
    && Math.round(report.expense * 100) === Object.values(report.natureTotals).reduce((sum, amount) => sum + Math.round(amount * 100), 0);
}

export function reportFacts(report?: DeterministicReport): string[] {
  if (!report) return [];
  return [
    `range_start:${report.range.startDate}`, `range_end:${report.range.endDate}`,
    `transaction_count:${report.transactionCount}`, `income_count:${report.incomeCount}`, `expense_count:${report.expenseCount}`,
    `income:${report.income}`, `expense:${report.expense}`, `balance:${report.balance}`,
    `nature_consumption:${report.natureTotals.消费}`, `nature_waste:${report.natureTotals.浪费}`,
    `nature_investment:${report.natureTotals.投资}`, `nature_unclassified:${report.natureTotals.未分类}`,
    `pending_date_count:${report.pendingDateCount}`,
  ];
}

export function validateAssistantRequest(value: unknown): value is AssistantRequest {
  if (!record(value) || Object.keys(value).some(key => !["text", "context", "report", "clarification"].includes(key))
    || !text(value.text, 1000) || !record(value.context) || !exactKeys(value.context, ["today", "timezone"])
    || !day(value.context.today) || !text(value.context.timezone, 64)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value.context.timezone }); } catch { return false; }
  if (value.report !== undefined && !validateReport(value.report)) return false;
  return value.clarification === undefined || (record(value.clarification)
    && exactKeys(value.clarification, ["originalText", "question", "answer"])
    && text(value.clarification.originalText, 2000) && text(value.clarification.question, 300) && text(value.clarification.answer, 1000)
    && value.clarification.answer === value.text);
}

const categories = ["餐饮", "购物", "交通", "居住", "健康", "医疗", "学习", "娱乐", "收入", "其他"];
export function validateAssistantDraft(value: unknown, today: string): value is TransactionDraft {
  return record(value) && exactKeys(value, ["type", "amount", "category", "occurred_at", "note", "nature_suggestion", "confidence", "ambiguous"])
    && validateTransactionDraft(value) && money(value.amount) && value.amount > 0 && value.amount <= 999999999999.99 && day(value.occurred_at) && value.occurred_at <= today
    && categories.includes(value.category) && text(value.note, 100, true)
    && (value.type === "income" ? value.category === "收入" && value.nature_suggestion === null : value.category !== "收入");
}

export function validateWorkflowOutput(value: unknown, request: AssistantRequest): value is AssistantWorkflowOutput {
  if (!record(value) || !exactKeys(value, ["intent", "transactions", "answer", "next_actions", "referenced_facts", "clarification", "confidence"])
    || !Array.isArray(value.transactions) || value.transactions.length > 5 || !value.transactions.every(item => validateAssistantDraft(item, request.context.today))
    || !text(value.answer, 1200, true) || !text(value.clarification, 300, true)
    || !Array.isArray(value.next_actions) || value.next_actions.length > 3 || !value.next_actions.every(item => text(item, 300))
    || !Array.isArray(value.referenced_facts) || value.referenced_facts.length > 13 || !value.referenced_facts.every(item => reportFacts(request.report).includes(item))
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return false;
  if (value.intent === "transactions") return value.transactions.length > 0 && value.transactions.every(item => item.ambiguous === false)
    && value.answer === "" && value.clarification === "" && value.next_actions.length === 0 && value.referenced_facts.length === 0;
  if (value.intent === "question") return value.transactions.length === 0 && value.answer.trim().length > 0 && value.clarification === "";
  return value.intent === "clarification" && value.transactions.length === 0 && value.answer === "" && value.clarification.trim().length > 0
    && value.next_actions.length === 0 && value.referenced_facts.length === 0;
}

export function toAssistantResult(value: AssistantWorkflowOutput, request: AssistantRequest, versions: { modelVersion: string; workflowVersion: string }): AssistantResult {
  if (value.intent === "question") return guardedReportAnswer(value, request);
  if (value.intent === "clarification") return { status: "clarification", question: value.clarification };
  const input = `${request.clarification?.originalText ?? ""}\n${request.text}`;
  const explicitWaste = /浪费|没必要|不该买|后悔|冲动消费|乱花|waste/i.test(input) && !/(?:不|没|非|无).{0,3}浪费/.test(input);
  return { status: "transactions", ...versions, drafts: value.transactions.map(draft => ({ ...draft,
    nature_suggestion: draft.type === "income" ? null : draft.nature_suggestion === null || (draft.nature_suggestion === "浪费" && !explicitWaste) ? "消费" : draft.nature_suggestion,
  })) };
}
