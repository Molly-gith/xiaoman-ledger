import type { AssistantFinancialSnapshot } from "../domain/assistant-snapshot";

/** Provider-neutral drafts only: this module never writes ledger data or calculates money. */
export type SuggestedNature = "消费" | "浪费" | "投资";
export type AIOperation =
  | "parseTransaction"
  | "recommendNature"
  | "generateDailyBrief"
  | "generateCycleReview"
  | "explainFinancialState"
  | "answerFinancialQuestion"
  | "generateFinancialCycleReview";
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
export type FinancialStage = "数据建立期" | "安全垫建立期" | "稳定积累期" | "资产增长期";
export interface FinancialStateExplanation {
  status_summary: string;
  financial_stage: FinancialStage | null;
  stage_evidence: string[];
  top_insights: string[];
  next_actions: string[];
  referenced_facts: string[];
  confidence: number;
}
export interface FinancialQuestionInput {
  question: string;
  snapshot: AssistantFinancialSnapshot;
}
export interface FinancialQuestionAnswer {
  answer: string;
  next_actions: string[];
  /** May be empty for pure safety/boundary answers; every supplied fact must come from the snapshot. */
  referenced_facts: string[];
  confidence: number;
}
export interface FinancialCycleReview {
  insights: string[];
  explanation: string;
  next_cycle_suggestions: string[];
  referenced_facts: string[];
}
/** Legacy generic fact envelope retained for existing Alpha capabilities. */
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
  explainFinancialState(snapshot: AssistantFinancialSnapshot, context: AIContext): Promise<AIResult<FinancialStateExplanation>>;
  answerFinancialQuestion(input: FinancialQuestionInput, context: AIContext): Promise<AIResult<FinancialQuestionAnswer>>;
  generateFinancialCycleReview(snapshot: AssistantFinancialSnapshot, context: AIContext): Promise<AIResult<FinancialCycleReview>>;
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
const isFinancialStage = (value: unknown): value is FinancialStage => value === "数据建立期" || value === "安全垫建立期" || value === "稳定积累期" || value === "资产增长期";
const isConfidence = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isMoney = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
  && value > 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
const isTextList = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every(isText);
const isReferencedFacts = (value: unknown, snapshot: AssistantFinancialSnapshot, requireNonEmpty = true): value is string[] => Array.isArray(value)
  && (!requireNonEmpty || value.length > 0)
  && value.every((item) => typeof item === "string" && snapshot.referencedFacts.includes(item));

function deterministicStage(snapshot: AssistantFinancialSnapshot): FinancialStage | null {
  const raw = snapshot.referencedFacts.find((fact) => fact.startsWith("financial_stage:"))?.slice("financial_stage:".length);
  return isFinancialStage(raw) ? raw : null;
}

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
export function validateFinancialStateExplanation(value: unknown, snapshot: AssistantFinancialSnapshot): value is FinancialStateExplanation {
  if (!isRecord(value) || !isText(value.status_summary) || !isTextList(value.stage_evidence, 3)
    || !isTextList(value.top_insights, 3) || !isTextList(value.next_actions, 3)
    || !isReferencedFacts(value.referenced_facts, snapshot) || !isConfidence(value.confidence)) return false;

  const stage = deterministicStage(snapshot);
  if (stage === null) return value.financial_stage === null && value.stage_evidence.length === 0;
  return value.financial_stage === stage && value.stage_evidence.length > 0;
}
export function validateFinancialQuestionAnswer(value: unknown, snapshot: AssistantFinancialSnapshot): value is FinancialQuestionAnswer {
  return isRecord(value) && isText(value.answer) && value.answer.length <= 1200
    && isTextList(value.next_actions, 3)
    && isReferencedFacts(value.referenced_facts, snapshot, false)
    && isConfidence(value.confidence);
}
export function validateFinancialCycleReview(value: unknown, snapshot: AssistantFinancialSnapshot): value is FinancialCycleReview {
  return isRecord(value) && isTextList(value.insights, 3) && isText(value.explanation)
    && isTextList(value.next_cycle_suggestions, 3) && isReferencedFacts(value.referenced_facts, snapshot);
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
    explainFinancialState: (snapshot, context) => run("explainFinancialState", snapshot, context, (value): value is FinancialStateExplanation => validateFinancialStateExplanation(value, snapshot)),
    answerFinancialQuestion: (input, context) => {
      if (!isText(input?.question)) return Promise.resolve({ status: "manual", reason: "invalid_output", originalText: input?.question ?? "" });
      return run("answerFinancialQuestion", input, context, (value): value is FinancialQuestionAnswer => validateFinancialQuestionAnswer(value, input.snapshot), input.question);
    },
    generateFinancialCycleReview: (snapshot, context) => run("generateFinancialCycleReview", snapshot, context, (value): value is FinancialCycleReview => validateFinancialCycleReview(value, snapshot)),
  };
}
