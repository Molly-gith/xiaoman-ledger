import { buildAssistantFinancialSnapshot } from "../lib/domain/assistant-snapshot.ts";

export const ORIGIN = "https://molly-gith.github.io";
export const ENDPOINT = "https://xiaoman-test.example/api/ai/question";
export const BETA_TOKEN = "test_beta_only_0123456789_abcdefghijklmnopqrstuvwxyz";
export const PROVIDER_KEY = "test-dify-only-not-a-real-secret";
export const PRIVATE_ERROR = "private upstream data and test-secret-do-not-echo";
export const env = {
  AI_ALLOWED_ORIGINS: ORIGIN,
  AI_BETA_TOKEN: BETA_TOKEN,
  DIFY_API_KEY: PROVIDER_KEY,
  DIFY_MODEL_VERSION: "test-model",
  DIFY_WORKFLOW_VERSION: "test-workflow-v1",
};

export function questionBody() {
  return {
    question: "我这个周期还能花多少钱？",
    consent: true,
    context: { today: "2026-10-09", timezone: "Asia/Hong_Kong" },
    snapshot: buildAssistantFinancialSnapshot({
      asOfDate: "2026-10-09", safeToSpend: 2500, unresolvedCount: 0,
      consumptionSpend: 600, wasteSpend: 100, investmentSpend: 200, investmentTarget: 500,
      investmentAccounts: [{
        id: "private-account-id", name: "private-account-name",
        currentMarketValue: 1100, netContribution: 1000, floatingPnL: 100,
      }],
    }),
  };
}

export function answerValue() {
  return {
    answer: "根据已核对的周期数据，本周期还可以花 2500 元。",
    next_actions: ["先留出计划内的必要支出。"],
    referenced_facts: ["safe_to_spend:2500"],
    confidence: 0.9,
  };
}

export function suggestion(value = answerValue()) {
  return {
    status: "suggestion", value, requiresConfirmation: true, confirmationReasons: ["user_review"],
    modelVersion: env.DIFY_MODEL_VERSION, workflowVersion: env.DIFY_WORKFLOW_VERSION,
  };
}

export function difyResponse(value = answerValue()) {
  return Response.json({ data: { status: "succeeded", outputs: { result_json: JSON.stringify(value) } } });
}

export function questionRequest(body = questionBody(), { method = "POST", headers = {}, url = ENDPOINT, ...options } = {}) {
  return new Request(url, {
    method,
    headers: { Origin: ORIGIN, Authorization: `Bearer ${BETA_TOKEN}`, "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    ...options,
  });
}
