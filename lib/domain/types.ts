export type ExpenseNature = "消费" | "浪费" | "投资";
export type SpendKind = "variable" | "reserved";
export type DateOnly = string;
export type UserProfile = { salaryDay: number };
export type FinancialCycle = { id: string; salaryDay: number; startDate: DateOnly; endDate: DateOnly; nextSalaryDate: DateOnly };
// All persisted amounts are yuan with at most two decimals. Arithmetic uses integer fen.
export type BudgetPlan = { cycleId: string; availableIncome: number; plannedSavings: number; necessaryReserve: number };
export type Transaction = {
  id: string; type: "expense" | "income"; amount: number; date: string;
  category: string; note: string; icon: string; source: "text" | "voice" | "import";
  cycleId: string | null; nature: ExpenseNature | null; spendKind: SpendKind | null;
  /** Pre-date-only records retain their original timestamp/cycle until date confirmation. */
  dateNeedsConfirmation?: boolean;
  aiSuggestion?: { nature: ExpenseNature; confidence: number; reason: string; modelVersion: string; promptVersion: string };
};
export type LedgerState = {
  app: "xiaoman-ledger"; version: 2; revision: number;
  ledgerKind: "personal" | "family" | "travel";
  profile: UserProfile | null; activeCycleId: string | null;
  cycles: FinancialCycle[]; budgets: BudgetPlan[]; transactions: Transaction[];
  settings: { monthlyBudget: number; savingsCurrent: number; savingsGoal: number };
};
