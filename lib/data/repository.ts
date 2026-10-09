import type { BudgetPlan, FinancialCycle, InvestmentAccount, InvestmentFlow, LedgerState, Transaction } from "../domain/types.ts";
import { calendarMonthCycle, calculateFinance, cents, parseDate, transactionDay } from "../domain/finance.ts";
import { normalizeBackup, normalizeInvestmentAccount, normalizeInvestmentFlow, normalizeMarketValueSnapshot, normalizeTransaction } from "./schema.ts";

export interface LedgerStore {
  read(): Promise<LedgerState>;
  // Must atomically reject stale revisions and resolve only after durable commit.
  commit(state: LedgerState, expectedRevision: number): Promise<void>;
}
export interface LedgerRepository {
  read(): Promise<LedgerState>;
  ensureCurrentCycle(today: string): Promise<LedgerState>;
  saveCycle(cycle: FinancialCycle, plan: BudgetPlan, revision: number): Promise<LedgerState>;
  replaceCurrentCycle(cycle: FinancialCycle, plan: BudgetPlan, revision: number): Promise<LedgerState>;
  saveTransaction(tx: Transaction, revision: number, editing?: boolean): Promise<LedgerState>;
  deleteTransaction(id: string, revision: number): Promise<LedgerState>;
  saveInvestmentAccount(account: InvestmentAccount, revision: number, editing?: boolean): Promise<LedgerState>;
  saveInvestmentFlow(flow: InvestmentFlow, revision: number): Promise<LedgerState>;
  saveMarketValue(accountId: string, marketValue: number, date: string, revision: number): Promise<LedgerState>;
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
    const metrics = calculateFinance(cycle, normalized.budgets.find(b => b.cycleId === cycle.id)!, normalized.transactions, normalized.investmentFlows);
    // Legacy periods keep their original reserve invariant. Nature-based periods no
    // longer have a reserve bucket at all.
    if (metrics.model === "legacy" && metrics.reserveRemaining < 0) throw new Error("必要预留额度不足，请先调整预算，或将超出部分另记为可变支出");
  }
  return normalized;
}
export function createRepository(store: LedgerStore): LedgerRepository {
  async function mutate(revision: number, change: (state: LedgerState) => LedgerState) {
    const state = await store.read();
    if (state.revision !== revision) throw new Error("账本已在其他页面更新，请重新载入后重试");
    const next = validateLedger({ ...change(structuredClone(state)), version: 3, revision: revision + 1 });
    await store.commit(next, revision); return next;
  }
  async function ensureCurrentCycle(today: string): Promise<LedgerState> {
    const month = calendarMonthCycle(today);
    // Deterministic IDs plus the store's atomic revision guard prevent two tabs
    // from creating duplicate months or overwriting a user's concurrent edit.
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = validateLedger(await store.read());
      const active = state.cycles.find(item => item.id === state.activeCycleId);
      if (active && (active.cycleType !== "calendar_month" || today <= active.endDate)) return state;
      const overlap = state.cycles.find(item => item.startDate <= month.endDate && item.endDate >= month.startDate);
      // Never reshape historical/custom periods to make room for an automatic month.
      if (overlap && overlap.id !== month.id) return state;
      const next = validateLedger({ ...state, revision: state.revision + 1,
        profile: null, activeCycleId: month.id,
        cycles: overlap ? state.cycles : [...state.cycles, month],
        budgets: overlap ? state.budgets : [...state.budgets, { cycleId: month.id, model: "nature",
          availableIncome: null, plannedSavings: null, necessaryReserve: 0, fundingSources: [] }],
      });
      try { await store.commit(next, state.revision); return next; }
      catch (error) {
        // Retry only a real concurrent revision change; storage failures stay visible.
        if ((await store.read()).revision === state.revision) throw error;
      }
    }
    throw new Error("账本已在其他页面更新，请重新载入后重试");
  }
  return {
    read: () => store.read().then(validateLedger),
    ensureCurrentCycle,
    saveCycle: (cycle, plan, revision) => mutate(revision, state => ({ ...state,
      profile: (cycle.cycleType ?? "salary_based") === "salary_based" ? { salaryDay: cycle.salaryDay } : null,
      activeCycleId: cycle.id,
      cycles: [...state.cycles.filter(c => c.id !== cycle.id), cycle],
      budgets: [...state.budgets.filter(b => b.cycleId !== cycle.id), plan],
    })),
    replaceCurrentCycle: (cycle, plan, revision) => mutate(revision, state => {
      const active = state.cycles.find(item => item.id === state.activeCycleId);
      if (!active) throw new Error("当前周期不存在，请重新载入后重试");
      if (active.id !== cycle.id && state.transactions.some(tx => tx.cycleId === active.id && (tx.dateNeedsConfirmation || tx.date.length > 10))) {
        throw new Error("旧账日期待核对，请先核对后再更换周期日期或方式");
      }
      // validateLedger verifies the canonical ID, every retained date, other
      // periods and budget invariants before any durable write takes place.
      return { ...state,
        profile: (cycle.cycleType ?? "salary_based") === "salary_based" ? { salaryDay: cycle.salaryDay } : null,
        activeCycleId: cycle.id,
        cycles: state.cycles.map(item => item.id === active.id ? cycle : item),
        budgets: state.budgets.map(item => item.cycleId === active.id ? plan : item),
        transactions: state.transactions.map(tx => tx.cycleId === active.id ? { ...tx, cycleId: cycle.id } : tx),
        investmentFlows: state.investmentFlows.map(flow => flow.cycleId === active.id ? { ...flow, cycleId: cycle.id } : flow),
      };
    }),
    saveTransaction: (value, revision, editing = false) => mutate(revision, state => {
      const tx = normalizeTransaction(value);
      tx.date = transactionDay(tx);
      delete tx.dateNeedsConfirmation;
      const exists = state.transactions.some(item => item.id === tx.id);
      if (editing !== exists) throw new Error(editing ? "账目已不存在" : "账目编号重复");
      if (!tx.cycleId || (tx.type === "expense" && !tx.nature)) throw new Error("请确认财务周期和消费性质");
      // spendKind is retained only for legacy schema compatibility. Users no longer
      // choose it; missing legacy values are safely normalized to variable spending.
      if (tx.type === "expense" && !tx.spendKind) tx.spendKind = "variable";
      if (tx.type === "income" && (tx.nature !== null || tx.spendKind !== null)) throw new Error("收入不设置消费性质或支出来源");
      return { ...state, transactions: [tx, ...state.transactions.filter(item => item.id !== tx.id)].sort((a, b) => b.date.localeCompare(a.date)) };
    }),
    deleteTransaction: (id, revision) => mutate(revision, state => {
      if (!state.transactions.some(tx => tx.id === id)) throw new Error("账目已不存在");
      return { ...state, transactions: state.transactions.filter(tx => tx.id !== id) };
    }),
    saveInvestmentAccount: (value, revision, editing = false) => mutate(revision, state => {
      const account = normalizeInvestmentAccount(value);
      const exists = state.investmentAccounts.some(item => item.id === account.id);
      if (editing !== exists) throw new Error(editing ? "投资账户已不存在" : "投资账户编号重复");
      const accounts = [account, ...state.investmentAccounts.filter(item => item.id !== account.id)];
      if (editing) return { ...state, investmentAccounts: accounts };
      const initial = normalizeMarketValueSnapshot({ id: `mv-${account.id}-${account.marketValueUpdatedAt}-${revision + 1}`, accountId: account.id, marketValue: account.currentMarketValue, date: account.marketValueUpdatedAt });
      return { ...state, investmentAccounts: accounts, marketValueSnapshots: [initial, ...state.marketValueSnapshots] };
    }),
    saveInvestmentFlow: (value, revision) => mutate(revision, state => {
      const flow = normalizeInvestmentFlow(value);
      if (state.investmentFlows.some(item => item.id === flow.id)) throw new Error("投资资金流编号重复");
      if (!state.investmentAccounts.some(account => account.id === flow.accountId)) throw new Error("投资账户不存在");
      if (flow.cycleId) {
        const cycle = state.cycles.find(item => item.id === flow.cycleId);
        if (!cycle || flow.date < cycle.startDate || flow.date > cycle.endDate) throw new Error("投资资金流不属于所选周期");
      }
      return { ...state, investmentFlows: [flow, ...state.investmentFlows].sort((a, b) => b.date.localeCompare(a.date)) };
    }),
    saveMarketValue: (accountId, marketValue, date, revision) => mutate(revision, state => {
      cents(marketValue); parseDate(date);
      const account = state.investmentAccounts.find(item => item.id === accountId);
      if (!account) throw new Error("投资账户不存在");
      const snapshot = normalizeMarketValueSnapshot({ id: `mv-${accountId}-${date}-${revision + 1}`, accountId, marketValue, date });
      const nextAccount = { ...account, currentMarketValue: marketValue, marketValueUpdatedAt: date };
      return { ...state, investmentAccounts: [nextAccount, ...state.investmentAccounts.filter(item => item.id !== accountId)], marketValueSnapshots: [snapshot, ...state.marketValueSnapshots] };
    }),
    replace: (state, revision) => mutate(revision, () => state),
  };
}
