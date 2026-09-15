import type { BudgetPlan, FinancialCycle, LedgerState, Transaction } from "../domain/types.ts";
import { calculateFinance, transactionDay } from "../domain/finance.ts";
import { normalizeBackup, normalizeTransaction } from "./schema.ts";

export interface LedgerStore {
  read(): Promise<LedgerState>;
  // Must atomically reject stale revisions and resolve only after durable commit.
  commit(state: LedgerState, expectedRevision: number): Promise<void>;
}
export interface LedgerRepository {
  read(): Promise<LedgerState>;
  saveCycle(cycle: FinancialCycle, plan: BudgetPlan, revision: number): Promise<LedgerState>;
  saveTransaction(tx: Transaction, revision: number, editing?: boolean): Promise<LedgerState>;
  deleteTransaction(id: string, revision: number): Promise<LedgerState>;
  replace(state: LedgerState, revision: number): Promise<LedgerState>;
}
export function validateLedger(state: LedgerState): LedgerState {
  const normalized = normalizeBackup(state);
  for (const tx of normalized.transactions) {
    if (tx.cycleId) {
      const cycle = normalized.cycles.find(c => c.id === tx.cycleId)!;
      const day = transactionDay(tx);
      if (tx.dateNeedsConfirmation) {
        // Preserve the previously confirmed cycle and original instant. Missing
        // source timezone cannot be reconstructed safely; ask for a calendar date.
        const instant = Date.parse(tx.date);
        const first = Date.parse(`${cycle.startDate}T00:00:00Z`) - 14 * 3600000;
        const last = Date.parse(`${cycle.nextSalaryDate}T00:00:00Z`) + 12 * 3600000;
        if (instant < first || instant >= last) throw new Error("旧账时间与原财务周期不一致，请核对备份");
      } else if (day < cycle.startDate || day > cycle.endDate) throw new Error("账目日期不属于所选周期");
    }
  }
  for (const cycle of normalized.cycles) {
    const metrics = calculateFinance(cycle, normalized.budgets.find(b => b.cycleId === cycle.id)!, normalized.transactions);
    if (metrics.reserveRemaining < 0) throw new Error("必要预留额度不足，请先调整预算，或将超出部分另记为可变支出");
  }
  return normalized;
}
export function createRepository(store: LedgerStore): LedgerRepository {
  async function mutate(revision: number, change: (state: LedgerState) => LedgerState) {
    const state = await store.read();
    if (state.revision !== revision) throw new Error("账本已在其他页面更新，请重新载入后重试");
    const next = validateLedger({ ...change(structuredClone(state)), revision: revision + 1 });
    await store.commit(next, revision); return next;
  }
  return {
    read: () => store.read().then(validateLedger),
    saveCycle: (cycle, plan, revision) => mutate(revision, state => ({ ...state, profile: { salaryDay: cycle.salaryDay }, activeCycleId: cycle.id,
      cycles: [...state.cycles.filter(c => c.id !== cycle.id), cycle], budgets: [...state.budgets.filter(b => b.cycleId !== cycle.id), plan] })),
    saveTransaction: (value, revision, editing = false) => mutate(revision, state => {
      const tx = normalizeTransaction(value);
      tx.date = transactionDay(tx);
      delete tx.dateNeedsConfirmation;
      const exists = state.transactions.some(item => item.id === tx.id);
      if (editing !== exists) throw new Error(editing ? "账目已不存在" : "账目编号重复");
      if (!tx.cycleId || (tx.type === "expense" && (!tx.nature || !tx.spendKind))) throw new Error("请确认财务周期、消费性质和支出来源");
      if (tx.type === "income" && (tx.nature !== null || tx.spendKind !== null)) throw new Error("收入不设置消费性质或支出来源");
      return { ...state, transactions: [tx, ...state.transactions.filter(item => item.id !== tx.id)].sort((a, b) => b.date.localeCompare(a.date)) };
    }),
    deleteTransaction: (id, revision) => mutate(revision, state => {
      if (!state.transactions.some(tx => tx.id === id)) throw new Error("账目已不存在");
      return { ...state, transactions: state.transactions.filter(tx => tx.id !== id) };
    }),
    replace: (state, revision) => mutate(revision, () => state),
  };
}
