import { cents, parseDate, salaryCycle } from "../domain/finance.ts";
import type { LedgerState, Transaction } from "../domain/types.ts";

export function defaultState(): LedgerState {
  return { app: "xiaoman-ledger", version: 2, revision: 0, ledgerKind: "personal", profile: null, activeCycleId: null,
    cycles: [], budgets: [], transactions: [], settings: { monthlyBudget: 15000, savingsCurrent: 0, savingsGoal: 100000 } };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("账本数据格式无效，原数据已保留");
  return value as Record<string, unknown>;
}
function amount(value: unknown): number {
  if (typeof value !== "number") throw new Error("账本金额格式无效");
  cents(value); return value;
}
function string(value: unknown, limit = 200): string {
  if (typeof value !== "string" || value.length > limit) throw new Error("账本字段格式无效");
  return value;
}
export function normalizeTransaction(value: unknown, legacy = false): Transaction {
  const v = record(value);
  if (v.type !== "income" && v.type !== "expense") throw new Error("收支类型无效");
  const date = string(v.date ?? v.occurred_at);
  if (date.length === 10) parseDate(date);
  else if (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error("账目日期无效");
  const nature = legacy ? null : v.nature;
  const spendKind = legacy ? null : v.spendKind;
  if (nature !== null && nature !== "消费" && nature !== "浪费" && nature !== "投资") throw new Error("消费性质无效");
  if (spendKind !== null && spendKind !== "variable" && spendKind !== "reserved") throw new Error("支出来源无效");
  const tx: Transaction = { id: string(String(v.id ?? "")), type: v.type, amount: amount(Number(v.amount)), date,
    category: string(v.category ?? "其他", 30), note: string(v.note ?? "", 100), icon: string(v.icon ?? "其", 2),
    source: v.source === "voice" || v.source === "import" ? v.source : "text",
    cycleId: legacy || v.cycleId === null ? null : string(v.cycleId), nature, spendKind };
  if (!tx.id || tx.amount <= 0) throw new Error("账目编号或金额无效");
  if (tx.cycleId && date.length > 10) tx.dateNeedsConfirmation = true;
  if (v.aiSuggestion !== undefined) {
    const suggestion = record(v.aiSuggestion);
    if (!["消费", "浪费", "投资"].includes(String(suggestion.nature)) || typeof suggestion.confidence !== "number" || !Number.isFinite(suggestion.confidence) || suggestion.confidence < 0 || suggestion.confidence > 1) throw new Error("AI 建议格式无效");
    tx.aiSuggestion = { nature: suggestion.nature as "消费" | "浪费" | "投资", confidence: suggestion.confidence, reason: string(suggestion.reason, 1000), modelVersion: string(suggestion.modelVersion), promptVersion: string(suggestion.promptVersion) };
  }
  return tx;
}
export function normalizeBackup(value: unknown): LedgerState {
  const v = record(value);
  if (v.app !== "xiaoman-ledger" || (v.version !== 1 && v.version !== 2) || !Array.isArray(v.transactions) || v.transactions.length > 5000) throw new Error("请选择有效的小满 JSON 备份（最多 5000 笔）");
  const state = defaultState(), settings = record(v.settings);
  state.ledgerKind = v.ledgerKind === "family" || v.ledgerKind === "travel" ? v.ledgerKind : "personal";
  state.settings = { monthlyBudget: amount(settings.monthlyBudget), savingsCurrent: amount(settings.savingsCurrent), savingsGoal: amount(settings.savingsGoal) };
  state.transactions = v.transactions.map(tx => normalizeTransaction(tx, v.version === 1));
  if (new Set(state.transactions.map(tx => tx.id)).size !== state.transactions.length) throw new Error("账目编号重复");
  if (v.version === 1) return state;
  if (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || !Array.isArray(v.cycles) || !Array.isArray(v.budgets)) throw new Error("周期数据格式无效");
  state.revision = Number(v.revision);
  if (v.profile !== null) {
    const p = record(v.profile); salaryCycle("2026-01-01", Number(p.salaryDay));
    state.profile = { salaryDay: Number(p.salaryDay) };
  }
  state.cycles = v.cycles.map(value => {
    const c = record(value), startDate = string(c.startDate);
    const expected = salaryCycle(startDate, Number(c.salaryDay));
    if (c.id !== expected.id || c.endDate !== expected.endDate || c.nextSalaryDate !== expected.nextSalaryDate || c.startDate !== expected.startDate) throw new Error("工资周期日期不一致");
    return expected;
  });
  const sorted = [...state.cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (sorted.some((cycle, i) => i > 0 && cycle.startDate <= sorted[i - 1].endDate)) throw new Error("财务周期不能重叠");
  state.budgets = v.budgets.map(value => {
    const b = record(value);
    const model = b.model === "nature" ? "nature" as const : "legacy" as const;
    return { cycleId: string(b.cycleId), availableIncome: amount(b.availableIncome), plannedSavings: amount(b.plannedSavings), necessaryReserve: amount(b.necessaryReserve), model };
  });
  if (state.budgets.length !== state.cycles.length || new Set(state.budgets.map(b => b.cycleId)).size !== state.budgets.length || state.budgets.some(b => !state.cycles.some(c => c.id === b.cycleId))) throw new Error("周期预算缺失或重复");
  state.activeCycleId = v.activeCycleId === null ? null : string(v.activeCycleId);
  if ((state.cycles.length > 0 && !state.activeCycleId) || (state.activeCycleId && !state.cycles.some(c => c.id === state.activeCycleId))) throw new Error("当前周期不存在");
  for (const tx of state.transactions) {
    if (tx.cycleId && !state.cycles.some(c => c.id === tx.cycleId)) throw new Error("账目所属周期不存在");
  }
  return state;
}
