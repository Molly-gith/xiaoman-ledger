import { checkRateLimit } from "@vercel/firewall";
import { handleAIRequest } from "../../lib/ai/question-handler.ts";

/** Vercel Node Function; the V6 web application remains on GitHub Pages. */
export default {
  fetch(request: Request): Promise<Response> {
    return handleAIRequest(request, {
      AI_ALLOWED_ORIGINS: process.env.AI_ALLOWED_ORIGINS ?? "",
      AI_BETA_TOKEN: process.env.AI_BETA_TOKEN ?? "",
      DIFY_API_KEY: process.env.DIFY_API_KEY ?? "",
      DIFY_MODEL_VERSION: process.env.DIFY_MODEL_VERSION ?? "",
      DIFY_WORKFLOW_VERSION: process.env.DIFY_WORKFLOW_VERSION ?? "",
    }, {
      checkLimit: async () => {
        // The SDK skips enforcement in development. Never use that path for live AI calls.
        if (process.env.NODE_ENV !== "production" || process.env.VERCEL !== "1" || !process.env.VERCEL_URL) throw new Error("Limiter unavailable");
        return checkRateLimit("xiaoman-question", {
          headers: new Headers({ host: process.env.VERCEL_URL }),
          rateLimitKey: "xiaoman-private-beta", timeout: 1500,
        });
      },
    });
  },
};
