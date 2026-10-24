import { isIP } from "node:net";
import { checkRateLimit } from "@vercel/firewall";
import type { AIEnv } from "./question-handler.ts";

export function serverAIEnv(): AIEnv {
  return { AI_ALLOWED_ORIGINS: process.env.AI_ALLOWED_ORIGINS ?? "", DIFY_API_KEY: process.env.DIFY_API_KEY ?? "",
    DIFY_MODEL_VERSION: process.env.DIFY_MODEL_VERSION ?? "", DIFY_WORKFLOW_VERSION: process.env.DIFY_WORKFLOW_VERSION ?? "" };
}

/** Only trust Vercel's overwritten edge header while running on Vercel. */
export function createLimitChecker(request: Request) {
  return async () => {
    const host = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL;
    const ip = request.headers.get("x-vercel-forwarded-for") ?? "";
    if (process.env.NODE_ENV !== "production" || process.env.VERCEL !== "1"
      || !host || host.length > 253 || host !== host.trim()
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)
      || !isIP(ip)) throw new Error("Limiter unavailable");
    const canonicalIP = ip.includes(":") ? new URL(`http://[${ip}]`).hostname : ip;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalIP));
    const rateLimitKey = `xiaoman-anonymous:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    // Both endpoints share this visitor's bucket. No global private-beta bucket,
    // caller Authorization, cookies or arbitrary host are forwarded to the SDK.
    return checkRateLimit("xiaoman-question", { headers: new Headers({ host }), rateLimitKey, timeout: 1500 });
  };
}
