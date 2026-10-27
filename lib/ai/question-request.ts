import type { AIContext, FinancialQuestionInput } from "./adapter.ts";
import type { AssistantFinancialSnapshot } from "../domain/assistant-snapshot.ts";

export type QuestionRequest = FinancialQuestionInput & { context: AIContext; consent: true };
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
const amount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e12;
const positive = (v: unknown): v is number => amount(v) && v >= 0;
const count = (v: unknown): v is number => positive(v) && Number.isSafeInteger(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Validate the V6 aggregate boundary; transaction notes, names and extra fields are rejected. */
export function validateQuestionRequest(value: unknown): value is QuestionRequest {
  if (!record(value) || !keys(value, ["question", "snapshot", "context", "consent"]) || value.consent !== true
    || typeof value.question !== "string" || !value.question.trim() || value.question.length > 500
    || !record(value.context) || !keys(value.context, ["today", "timezone"]) || !date(value.context.today)
    || typeof value.context.timezone !== "string" || value.context.timezone.length > 64) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value.context.timezone }); } catch { return false; }
  const s = value.snapshot;
  if (!record(s) || !keys(s, ["asOfDate", "readiness", "unresolvedCount", "period", "investmentAssets", "referencedFacts"])
    || !date(s.asOfDate) || s.asOfDate !== value.context.today || !count(s.unresolvedCount)
    || !record(s.period) || !record(s.investmentAssets)) return false;
  const p = s.period, a = s.investmentAssets;
  if (!keys(p, ["safeToSpend", "consumptionSpend", "wasteSpend", "investmentSpend", "investmentTarget", "investmentGap"])
    || !(p.safeToSpend === null || amount(p.safeToSpend))
    || ![p.consumptionSpend, p.wasteSpend, p.investmentSpend].every(positive)
    || !(p.investmentTarget === null ? p.investmentGap === null : positive(p.investmentTarget) && positive(p.investmentGap))
    || !keys(a, ["accountCount", "totalMarketValue", "totalNetContribution", "totalFloatingPnL", "hasUnknownCost"])
    || !count(a.accountCount) || !positive(a.totalMarketValue) || typeof a.hasUnknownCost !== "boolean"
    || !(a.totalNetContribution === null || amount(a.totalNetContribution))
    || !(a.totalFloatingPnL === null || amount(a.totalFloatingPnL))) return false;
  if (s.readiness !== (s.unresolvedCount > 0 || p.safeToSpend === null ? "needs_review" : "ready")
    || (s.unresolvedCount > 0 && p.safeToSpend !== null)
    || (a.hasUnknownCost ? a.totalNetContribution !== null || a.totalFloatingPnL !== null : a.totalNetContribution === null || a.totalFloatingPnL === null)) return false;
  // Facts are labels for already calculated values, never caller-provided instructions.
  const facts = snapshotFacts(s as AssistantFinancialSnapshot);
  return Array.isArray(s.referencedFacts) && s.referencedFacts.length === facts.length
    && s.referencedFacts.every((fact, index) => fact === facts[index]);
}

export function snapshotFacts(s: AssistantFinancialSnapshot): string[] {
  const p = s.period, a = s.investmentAssets;
  return [
    `as_of:${s.asOfDate}`, `readiness:${s.readiness}`, `unresolved_count:${s.unresolvedCount}`,
    p.safeToSpend === null ? "safe_to_spend:unknown" : `safe_to_spend:${p.safeToSpend}`,
    `consumption_spend:${p.consumptionSpend}`, `waste_spend:${p.wasteSpend}`,
    `investment_spend:${p.investmentSpend}`,
    p.investmentTarget === null ? "investment_target:unknown" : `investment_target:${p.investmentTarget}`,
    p.investmentGap === null ? "investment_gap:unknown" : `investment_gap:${p.investmentGap}`,
    `investment_market_value:${a.totalMarketValue}`,
    a.hasUnknownCost ? "investment_cost_basis:partial_or_unknown" : `investment_net_contribution:${a.totalNetContribution}`,
    a.hasUnknownCost ? "investment_floating_pnl:unknown" : `investment_floating_pnl:${a.totalFloatingPnL}`,
    `investment_account_count:${a.accountCount}`,
  ];
}

/** Bound memory even when the peer omits Content-Length or uses a streamed body. */
export async function readLimitedJson(message: Request | Response, maxBytes: number): Promise<unknown> {
  if (Number(message.headers.get("Content-Length")) > maxBytes || !message.body) throw new Error("Invalid body");
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body));
}
