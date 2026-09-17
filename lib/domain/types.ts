export type ExpenseNature = "消费" | "浪费" | "投资";
export type SpendKind = "variable" | "reserved";
export type BudgetModel = "legacy" | "nature";
export type DateOnly = string;
export type UserProfile = { salaryDay: number };
export type FinancialCycle = { id: string; salaryDay: number; startDate: DateOnly; endDate: DateOnly; nextSalaryDate: DateOnly };
// All persisted amounts are yuan with at most two decimals. Arithmetic uses integer fen.
// `plannedSavings` is kept for backwards compatibility. In the `nature` model it is the
// protected investment/savings target amount shown to users as “投资目标”.
export type BudgetPlan = { cycleId: string; availableIncome: number; plannedSavings: number; necessaryReserve: number; model?: BudgetModel };
export type Transaction = {
  id: string; type: "expense" | "income"; amount: number; date: string;
  category: string; note: string; icon: string; source: "text" | "voice" | "import";
  cycleId: string | null; nature: ExpenseNature | null; spendKind: SpendKind | null;
  /** Pre-date-only records retain their original timestamp/cycle until date confirmation. */
  dateNeedsConfirmation?: boolean;
  aiSuggestion?: { nature: ExpenseNature; confidence: number; reason: string; modelVersion: string; promptVersion: string };
};
export type InvestmentAccount = {
  id: string;
  name: string;
  /** Historical net contributions before Xiaoman started tracking this account. Null means unknown. */
  openingNetContribution: number | null;
  currentMarketValue: number;
  marketValueUpdatedAt: DateOnly;
  createdAt: DateOnly;
};
export type InvestmentFlow = {
  id: string;
  accountId: string;
  type: "contribution" | "withdrawal";
  amount: number;
  date: DateOnly;
  /** Contributions tied to a salary cycle count toward that cycle's investment progress. */
  cycleId: string | null;
};
export type MarketValueSnapshot = {
  id: string;
  accountId: string;
  marketValue: number;
  date: DateOnly;
};
export type LedgerState = {
  app: "xiaoman-ledger"; version: 3; revision: number;
  ledgerKind: "personal" | "family" | "travel";
  profile: UserProfile | null; activeCycleId: string | null;
  cycles: FinancialCycle[]; budgets: BudgetPlan[]; transactions: Transaction[];
  investmentAccounts: InvestmentAccount[];
  investmentFlows: InvestmentFlow[];
  marketValueSnapshots: MarketValueSnapshot[];
  settings: { monthlyBudget: number; savingsCurrent: number; savingsGoal: number };
};
