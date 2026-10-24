import { handleAssistantRequest } from "../../lib/ai/assistant-handler.ts";
import { createLimitChecker, serverAIEnv } from "../../lib/ai/vercel-runtime.ts";

export default {
  fetch(request: Request): Promise<Response> {
    return handleAssistantRequest(request, serverAIEnv(), { checkLimit: createLimitChecker(request) });
  },
};
