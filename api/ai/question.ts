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
        // Standard Protection gates the generated deployment URL, including in production.
        // Never fall back to it when the public production domain is missing.
        const host = process.env.VERCEL_ENV === "production"
          ? process.env.VERCEL_PROJECT_PRODUCTION_URL
          : process.env.VERCEL_URL;
        if (process.env.NODE_ENV !== "production" || process.env.VERCEL !== "1"
          || !host || host.length > 253 || host !== host.trim()
          || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)) throw new Error("Limiter unavailable");
        return checkRateLimit("xiaoman-question", {
          // Do not forward the caller's Authorization, cookies or arbitrary host.
          headers: new Headers({ host }),
          rateLimitKey: "xiaoman-private-beta", timeout: 1500,
        });
      },
    });
  },
};
