import type { BudgetPlan, FinancialCycle, InvestmentAccount, InvestmentFlow, LedgerKind, LedgerState, Transaction } from "../domain/types.ts";
import { calendarMonthCycle, cents, parseDate, transactionDay } from "../domain/finance.ts";
import { LEDGER_KINDS, ledgerDataOf, normalizeBackup, normalizeInvestmentAccount, normalizeInvestmentFlow, normalizeMarketValueSnapshot, normalizeTransaction } from "./schema.ts";

export interface LedgerStore {
  read(): Promise<LedgerState>;
  // Must atomically reject stale revisions and resolve only after durable commit.
  commit(state: LedgerState, expectedRevision: number): Promise<void>;
}
export interface LedgerRepository {
  read(): Promise<LedgerState>;
  switchLedger(kind: LedgerKind, revision: number): Promise<LedgerState>;
  ensureCurrentCycle(today: string): Promise<LedgerState>;
  saveCycle(cycle: FinancialCycle, plan: BudgetPlan, revision: number): Promise<LedgerState>;
  replaceCurrentCycle(cycle: FinancialCycle, plan: BudgetPlan, revision: number): Promise<LedgerState>;
  saveTransaction(tx: Transaction, revision: number, editing?: boolean): Promise<LedgerState>;
  saveTransactions(transactions: readonly Transaction[], revision: number): Promise<LedgerState>;
  deleteTransaction(id: string, revision: number): Promise<LedgerState>;
  deleteTransactions(ids: readonly string[], revision: number): Promise<LedgerState>;
  saveInvestmentAccount(account: InvestmentAccount, revision: number, editing?: boolean): Promise<LedgerState>;
  saveInvestmentFlow(flow: InvestmentFlow, revision: number): Promise<LedgerState>;
  saveMarketValue(accountId: string, marketValue: number, date: string, revision: number): Promise<LedgerState>;
  replace(state: LedgerState, revision: number): Promise<LedgerState>;
}
export function validateLedger(state: LedgerState): LedgerState {
  return normalizeBackup(state);
}
export function createRepository(store: LedgerStore): LedgerRepository {
  function prepareTransaction(value: Transaction): Transaction {
    const tx = normalizeTransaction(value);
    tx.date = transactionDay(tx);
    delete tx.dateNeedsConfirmation;
    if (tx.type === "expense" && !tx.nature) throw new Error("请确认消费性质");
    // A cycle is optional. The legacy spend kind is retained for old clients;
    // any explicit cycle still receives the full date and budget validation.
    if (tx.type === "expense" && !tx.spendKind) tx.spendKind = "variable";
    if (tx.type === "income" && (tx.nature !== null || tx.spendKind !== null)) throw new Error("收入不设置消费性质或支出来源");
    return tx;
  }
  async function mutate(revision: number, change: (state: LedgerState) => LedgerState) {
    const state = validateLedger(await store.read());
    if (state.revision !== revision) throw new Error("账本已在其他页面更新，请重新载入后重试");
    const next = validateLedger({ ...change(structuredClone(state)), version: 4, revision: revision + 1 });
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
    switchLedger: (kind, revision) => mutate(revision, state => {
      if (!LEDGER_KINDS.includes(kind)) throw new Error("账本用途无效");
      if (kind === state.ledgerKind) return state;
      const destination = state.otherLedgers[kind];
      if (!destination) throw new Error("目标账本不存在，请重新载入");
      const otherLedgers = { ...state.otherLedgers, [state.ledgerKind]: ledgerDataOf(state) };
      delete otherLedgers[kind];
      return { ...state, ...destination, ledgerKind: kind, otherLedgers };
    }),
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
      const tx = prepareTransaction(value);
      const exists = state.transactions.some(item => item.id === tx.id);
      if (editing !== exists) throw new Error(editing ? "账目已不存在" : "账目编号重复");
      return { ...state, transactions: [tx, ...state.transactions.filter(item => item.id !== tx.id)].sort((a, b) => b.date.localeCompare(a.date)) };
    }),
    saveTransactions: (values, revision) => mutate(revision, state => {
      if (!Array.isArray(values) || values.length === 0) throw new Error("请先确认要保存的账目");
      const transactions = values.map(prepareTransaction);
      const ids = new Set(state.transactions.map(tx => tx.id));
      for (const tx of transactions) {
        if (ids.has(tx.id)) throw new Error("账目编号重复");
        ids.add(tx.id);
      }
      // One revision and one durable commit: invalid drafts never partially save.
      return { ...state, transactions: [...transactions, ...state.transactions].sort((a, b) => b.date.localeCompare(a.date)) };
    }),
    deleteTransaction: (id, revision) => mutate(revision, state => {
      if (!state.transactions.some(tx => tx.id === id)) throw new Error("账目已不存在");
      return { ...state, transactions: state.transactions.filter(tx => tx.id !== id) };
    }),
    deleteTransactions: (ids, revision) => mutate(revision, state => {
      if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) throw new Error("撤销账目列表无效");
      const existing = new Set(state.transactions.map(tx => tx.id));
      if (ids.some(id => !existing.has(id))) throw new Error("账目已不存在");
      const removed = new Set(ids);
      // For undo, pass the revision returned by saveTransactions. Any intervening
      // edit makes it stale instead of silently deleting the newer user changes.
      return { ...state, transactions: state.transactions.filter(tx => !removed.has(tx.id)) };
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
