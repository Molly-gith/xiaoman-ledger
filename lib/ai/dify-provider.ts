import type { AIContext, AIOperation, AIProvider } from "./adapter";

export interface DifyProviderOptions {
  /** Base URL such as https://api.dify.ai or a self-hosted Dify origin. */
  baseUrl: string;
  /** Server-side secret. Never expose this provider in browser bundles. */
  apiKey: string;
  /** Stable identifier for the Dify workflow revision/configuration. */
  workflowVersion: string;
  /** Model identifier recorded in eval results. */
  modelVersion: string;
  /** Pseudonymous Dify user id used for provider-side traceability. */
  userId?: string;
  fetchFn?: typeof fetch;
}

type DifyBlockingResponse = {
  data?: {
    outputs?: Record<string, unknown>;
  };
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(trimmed)) throw new Error("Dify baseUrl must use https");
  return trimmed;
}

function parseWorkflowResult(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid Dify response");
  const outputs = (payload as DifyBlockingResponse).data?.outputs;
  if (!outputs || typeof outputs !== "object") throw new Error("Missing Dify workflow outputs");
  const raw = outputs.result_json ?? outputs.result ?? outputs.output;
  if (raw === undefined) throw new Error("Missing Dify result output");
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Dify result output is not valid JSON");
  }
}

/**
 * Optional server-side Dify adapter for product prototyping/learning.
 *
 * Inputs remain provider-neutral: operation, payload, context. The workflow may support
 * transaction parsing as well as AI-first financial-state/review operations. The final
 * output is always validated by createAIAdapter(), so Dify never becomes the source of truth.
 */
export function createDifyProvider(options: DifyProviderOptions): AIProvider {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Dify apiKey is required");
  if (!options.workflowVersion.trim() || !options.modelVersion.trim()) throw new Error("Dify version metadata is required");
  const fetchFn = options.fetchFn ?? fetch;
  const user = options.userId?.trim() || "xiaoman-eval";

  return {
    workflowVersion: options.workflowVersion,
    modelVersion: options.modelVersion,
    async generate(operation: AIOperation, input: unknown, context: AIContext, signal: AbortSignal): Promise<unknown> {
      const response = await fetchFn(`${baseUrl}/v1/workflows/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: {
            operation,
            payload: JSON.stringify(input),
            context: JSON.stringify(context),
          },
          response_mode: "blocking",
          user,
        }),
        signal,
      });
      if (!response.ok) throw new Error(`Dify request failed with status ${response.status}`);
      return parseWorkflowResult(await response.json());
    },
  };
}
