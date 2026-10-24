import { handleAIRequest } from "../../lib/ai/question-handler.ts";
import { createLimitChecker, serverAIEnv } from "../../lib/ai/vercel-runtime.ts";

/** Vercel Node Function; the V6 web application remains on GitHub Pages. */
export default {
  fetch(request: Request): Promise<Response> {
    return handleAIRequest(request, serverAIEnv(), { checkLimit: createLimitChecker(request) });
  },
};
