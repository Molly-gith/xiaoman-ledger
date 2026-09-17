import type { AIContext, AIOperation, AIProvider } from "./adapter";

export interface OpenAICompatibleProviderOptions {
  /** OpenAI-compatible API origin, e.g. https://api.openai.com/v1 or https://api.deepseek.com. */
  baseUrl: string;
  /** Server-side secret. Never expose this provider in browser bundles. */
  apiKey: string;
  /** Provider model id, e.g. gpt-5-mini, deepseek-chat, qwen-plus. */
  model: string;
  /** Stable prompt/orchestration revision recorded in eval results. */
  workflowVersion: string;
  /** Optional model version override for eval reporting; defaults to model. */
  modelVersion?: string;
  fetchFn?: typeof fetch;
}

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(trimmed)) throw new Error("AI baseUrl must use https");
  return trimmed;
}

function systemPrompt(operation: AIOperation): string {
  const shared = [
    "你是‘小满’的结构化 AI 能力层。输出只作为建议，不直接修改账本。",
    "必须且只能输出一个合法 JSON 对象，不要 Markdown、代码块、解释前后缀或思考过程。",
    "金额、预算、财务周期等确定性计算由业务代码完成；不要重算输入里已经给出的财务事实。",
  ];
  if (operation === "parseTransaction") {
    return [...shared,
      "任务：把自然语言记账解析为 TransactionDraft。",
      "JSON schema: {type:'income'|'expense',amount:正数且最多两位小数,category:'非空字符串',occurred_at:'YYYY-MM-DD',note:'字符串',nature_suggestion:'消费'|'浪费'|'投资'|null,confidence:0到1,ambiguous:boolean}。",
      "收入的 nature_suggestion 必须为 null。相对日期必须基于 context.today 与 context.timezone。缺少关键信息时不要编造，降低 confidence 并设置 ambiguous=true。",
    ].join("\n");
  }
  if (operation === "recommendNature") {
    return [...shared,
      "任务：对支出给出消费/浪费/投资建议。",
      "JSON schema: {recommended_nature:'消费'|'浪费'|'投资',acceptable_alternative?:'消费'|'浪费'|'投资',reason:'非空字符串',confidence:0到1}。",
    ].join("\n");
  }
  if (operation === "generateDailyBrief") {
    return [...shared,
      "任务：基于 payload 已给出的确定性财务事实生成每日简报。",
      "JSON schema: {summary:'不超过300字',suggestion:'不超过300字'|null}。",
    ].join("\n");
  }
  return [...shared,
    "任务：基于 payload 已给出的确定性财务事实生成周期复盘。",
    "JSON schema: {insights:[最多3条非空字符串],explanation:'非空字符串',next_cycle_suggestions:[最多3条非空字符串]}。",
  ].join("\n");
}

function parseResponse(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid AI response");
  const content = (payload as ChatCompletionsResponse).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Missing AI response content");
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("AI response content is not valid JSON");
  }
}

/**
 * Server-side provider using an OpenAI-compatible Chat Completions endpoint.
 *
 * This intentionally keeps orchestration in version-controlled code instead of a visual workflow UI,
 * so the product team can modify prompts/contracts through normal PR + CI flow. The returned object is
 * still validated by createAIAdapter(), and never writes ledger data directly.
 */
export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): AIProvider {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = options.apiKey.trim();
  const model = options.model.trim();
  const workflowVersion = options.workflowVersion.trim();
  if (!apiKey) throw new Error("AI apiKey is required");
  if (!model) throw new Error("AI model is required");
  if (!workflowVersion) throw new Error("AI workflowVersion is required");
  const fetchFn = options.fetchFn ?? fetch;

  return {
    workflowVersion,
    modelVersion: options.modelVersion?.trim() || model,
    async generate(operation: AIOperation, input: unknown, context: AIContext, signal: AbortSignal): Promise<unknown> {
      const response = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt(operation) },
            { role: "user", content: JSON.stringify({ operation, payload: input, context }) },
          ],
        }),
        signal,
      });
      if (!response.ok) throw new Error(`AI request failed with status ${response.status}`);
      return parseResponse(await response.json());
    },
  };
}
