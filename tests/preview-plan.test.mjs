import assert from "node:assert/strict";
import test from "node:test";
import { selectPreviewPlan } from "../scripts/preview-plan.mjs";

const repository = "Molly-gith/xiaoman-ledger";
const sha = "a".repeat(40);
const newerSha = "b".repeat(40);
const run = (changes = {}) => ({
  id: 100, workflow_id: 358468136, event: "pull_request", status: "completed", conclusion: "success",
  run_number: 150, head_repository: { full_name: repository }, head_branch: "codex/xiaoman-ai-beta",
  head_sha: sha, pull_requests: [{ number: 24, head: { sha: "c".repeat(40) } }], ...changes,
});
const plan = (changes = {}) => selectPreviewPlan({ repository, eventName: "workflow_dispatch", retainedRuns: [run()], ...changes });

test("manual restoration retains PR24 at its successful run SHA, not its current PR head", () => {
  assert.deepEqual(plan(), { ai_sha: sha, ai_run_id: "100", current_pr: "", current_sha: "", entry_pr: "24" });
});

test("other PR releases retain AI while giving the current validated PR its own path", () => {
  const result = plan({ eventName: "workflow_run", eventRun: run({ head_branch: "codex/another-pr", head_sha: newerSha, pull_requests: [{ number: 25 }] }) });
  assert.equal(result.ai_sha, sha);
  assert.equal(result.current_pr, "25");
  assert.equal(result.current_sha, newerSha);
  assert.equal(result.entry_pr, "25");
});

test("PR23 never overrides the fixed accepted V6 checkout", () => {
  const result = plan({ eventName: "workflow_run", eventRun: run({ head_branch: "sprint/v0.3-v6-financial-cycle", head_sha: newerSha, pull_requests: [{ number: 23 }] }) });
  assert.equal(result.current_pr, "");
  assert.equal(result.current_sha, "");
  assert.equal(result.entry_pr, "23");
});

test("a new successful PR24 event is usable immediately; an older rerun cannot replace a newer validated run", () => {
  const fresh = run({ run_number: 151, head_sha: newerSha });
  assert.equal(plan({ eventName: "workflow_run", eventRun: fresh, retainedRuns: [] }).ai_sha, newerSha);
  assert.equal(plan({ eventName: "workflow_run", eventRun: run(), retainedRuns: [fresh] }).ai_sha, newerSha);
});

test("forks, wrong branches, wrong PRs and unsuccessful runs cannot become retained AI", () => {
  const untrusted = [
    run({ head_repository: { full_name: "other/xiaoman-ledger" } }),
    run({ head_branch: "codex/unrelated" }),
    run({ pull_requests: [{ number: 25 }] }),
    run({ workflow_id: 1 }), run({ event: "push" }), run({ status: "in_progress" }),
    run({ conclusion: "failure" }), run({ head_sha: "main" }),
  ];
  for (const candidate of untrusted) assert.throws(() => plan({ retainedRuns: [candidate] }), /No successful/);
  assert.throws(() => plan({ retainedRuns: [] }), /No successful/);
});

test("unvalidated or malformed current PR input is rejected before checkout", () => {
  for (const eventRun of [run({ conclusion: "failure" }), run({ head_sha: "a; unexpected" }), run({ pull_requests: [{ number: "24; unexpected" }] })]) {
    assert.throws(() => plan({ eventName: "workflow_run", eventRun }), /Current PR must/);
  }
  assert.throws(() => plan({ eventName: "workflow_run", eventRun: run({ head_branch: "wrong" }) }), /Unexpected PR24/);
});
