/** Provider-neutral drafts only: this module never writes ledger data or calculates money. */
export type SuggestedNature = "消费" | "浪费" | "投资";
export type AIOperation = "parseTransaction" | "recommendNature" | "generateDailyBrief" | "generateCycleReview";
export interface AIContext {
  /** Explicit local date makes relative-date interpretation reproducible. */
  today: string;
  timezone: string;
  preferences?: Readonly<Record<string, string>>;
}
export interface TransactionDraft {
  type: "income" | "expense";
  /** Yuan, at most two decimal places; not a committed transaction. */
  amount: number;
  category: string;
  occurred_at: string;
  note: string;
  nature_suggestion: SuggestedNature | null;
  confidence: number;
  ambiguous: boolean;
}
export interface NatureRecommendation {
  recommended_nature: SuggestedNature;
  acceptable_alternative?: SuggestedNature;
  reason: string;
  confidence: number;
}
export interface DailyBrief { summary: string; suggestion: string | null }
export interface CycleReview { insights: string[]; explanation: string; next_cycle_suggestions: string[] }
/** All numbers and comparisons must already have been computed by deterministic rules. */
export interface FinancialFacts {
  metrics: Readonly<Record<string, number | string | null>>;
  signals: readonly string[];
  lifeStatus?: string;
}
export type AIResult<T> = {
  status: "suggestion";
  value: T;
  requiresConfirmation: true;
  confirmationReasons: string[];
  modelVersion: string;
  workflowVersion: string;
} | {
  status: "manual";
  reason: "disabled" | "unavailable" | "invalid_output";
  /** The UI can restore this exact input into the manual form after failure. */
  originalText?: string;
};
export interface AIAdapter {
  parseTransaction(input: string, context: AIContext): Promise<AIResult<TransactionDraft>>;
  recommendNature(transaction: TransactionDraft, context: AIContext): Promise<AIResult<NatureRecommendation>>;
  generateDailyBrief(snapshot: FinancialFacts, context: AIContext): Promise<AIResult<DailyBrief>>;
  generateCycleReview(metrics: FinancialFacts, context: AIContext): Promise<AIResult<CycleReview>>;
}
export interface AIProvider {
  modelVersion: string;
  workflowVersion: string;
  /** Future network providers must honor signal and keep credentials on the server. */
  generate(operation: AIOperation, input: unknown, context: AIContext, signal: AbortSignal): Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isNature = (value: unknown): value is SuggestedNature => value === "消费" || value === "浪费" || value === "投资";
const isConfidence = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isMoney = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
  && value > 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
const isTextList = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every(isText);

export function validateTransactionDraft(value: unknown): value is TransactionDraft {
  return isRecord(value) && (value.type === "income" || value.type === "expense") && isMoney(value.amount)
    && isText(value.category) && isDate(value.occurred_at) && typeof value.note === "string"
    && (value.nature_suggestion === null || isNature(value.nature_suggestion))
    && (value.type !== "income" || value.nature_suggestion === null)
    && isConfidence(value.confidence) && typeof value.ambiguous === "boolean";
}
export function validateNatureRecommendation(value: unknown): value is NatureRecommendation {
  return isRecord(value) && isNature(value.recommended_nature) && isText(value.reason) && isConfidence(value.confidence)
    && (value.acceptable_alternative === undefined || isNature(value.acceptable_alternative));
}
export function validateDailyBrief(value: unknown): value is DailyBrief {
  return isRecord(value) && isText(value.summary) && value.summary.length <= 300
    && (value.suggestion === null || (isText(value.suggestion) && value.suggestion.length <= 300));
}
export function validateCycleReview(value: unknown): value is CycleReview {
  return isRecord(value) && isTextList(value.insights, 3) && isText(value.explanation)
    && isTextList(value.next_cycle_suggestions, 3);
}

/** Omit provider for the Alpha default. No network client, token, or storage is created. */
export function createAIAdapter(provider?: AIProvider, options: { timeoutMs?: number; lowConfidenceThreshold?: number } = {}): AIAdapter {
  const timeoutMs = options.timeoutMs ?? 8000;
  const threshold = options.lowConfidenceThreshold ?? 0.8;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !isConfidence(threshold)) throw new Error("Invalid AI adapter options");
  async function run<T>(operation: AIOperation, input: unknown, context: AIContext, validate: (value: unknown) => value is T, originalText?: string): Promise<AIResult<T>> {
    const fallback = (reason: "disabled" | "unavailable" | "invalid_output"): AIResult<T> => ({ status: "manual", reason, ...(originalText === undefined ? {} : { originalText }) });
    if (!provider) return fallback("disabled");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("AI deadline exceeded")); }, timeoutMs);
      });
      const value = await Promise.race([provider.generate(operation, input, context, controller.signal), deadline]);
      if (!validate(value)) return fallback("invalid_output");
      const confirmationReasons = ["user_review"];
      if (isRecord(value) && isConfidence(value.confidence) && value.confidence < threshold) confirmationReasons.push("low_confidence");
      if (isRecord(value) && value.ambiguous === true) confirmationReasons.push("ambiguous_input");
      return { status: "suggestion", value, requiresConfirmation: true, confirmationReasons, modelVersion: provider.modelVersion, workflowVersion: provider.workflowVersion };
    } catch {
      // Never include provider errors in UI results: they may contain input or secrets.
      return fallback("unavailable");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return {
    parseTransaction: (input, context) => run("parseTransaction", input, context, validateTransactionDraft, input),
    recommendNature: (transaction, context) => run("recommendNature", transaction, context, validateNatureRecommendation),
    generateDailyBrief: (snapshot, context) => run("generateDailyBrief", snapshot, context, validateDailyBrief),
    generateCycleReview: (metrics, context) => run("generateCycleReview", metrics, context, validateCycleReview),
  };
}
