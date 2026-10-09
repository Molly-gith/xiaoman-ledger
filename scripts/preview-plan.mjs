const WORKFLOW_ID = 358468136;
const AI_BRANCH = "codex/xiaoman-ai-beta";
const SHA = /^[0-9a-f]{40}$/;

function validatedRun(run, repository) {
  return run?.workflow_id === WORKFLOW_ID &&
    run.event === "pull_request" && run.status === "completed" &&
    run.conclusion === "success" && run.head_repository?.full_name === repository &&
    typeof run.head_sha === "string" && SHA.test(run.head_sha) &&
    Number.isSafeInteger(run.run_number) && run.run_number > 0;
}

function prNumber(run) {
  const number = run?.pull_requests?.[0]?.number;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function selectPreviewPlan({ repository, eventName, eventRun, retainedRuns }) {
  if (typeof repository !== "string" || !repository.includes("/")) throw new Error("Repository is required");
  if (eventName !== "workflow_dispatch" && eventName !== "workflow_run") throw new Error("Unsupported event");
  if (eventName === "workflow_run" && (!validatedRun(eventRun, repository) || !prNumber(eventRun))) {
    throw new Error("Current PR must have successful validation in this repository");
  }

  // PR metadata can follow a newer head; use the SHA attached to the successful run.
  const candidates = [...retainedRuns, ...(eventName === "workflow_run" ? [eventRun] : [])]
    .filter(run => validatedRun(run, repository) && run.head_branch === AI_BRANCH && prNumber(run) === 24)
    .sort((left, right) => right.run_number - left.run_number);
  const aiRun = candidates[0];
  if (!aiRun) throw new Error("No successful same-repository PR24 validation; preserve the existing site");

  const currentPr = eventName === "workflow_run" ? prNumber(eventRun) : undefined;
  if (currentPr === 24 && eventRun.head_branch !== AI_BRANCH) throw new Error("Unexpected PR24 branch");
  const otherPr = currentPr && currentPr !== 23 && currentPr !== 24;
  return {
    ai_sha: aiRun.head_sha,
    ai_run_id: String(aiRun.id),
    current_pr: otherPr ? String(currentPr) : "",
    current_sha: otherPr ? eventRun.head_sha : "",
    entry_pr: String(currentPr ?? 24),
  };
}
