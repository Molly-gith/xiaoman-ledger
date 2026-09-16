/** Harness plumbing only; human-reviewed production datasets and review rubrics are pending. */
export async function runEvaluation(adapter, cases) {
  const rows = [];
  for (const item of cases) {
    const result = await adapter[item.capability](item.user_input, item.user_context);
    if (result.status !== "suggestion") {
      rows.push({
        case_id: item.case_id,
        status: "failed",
        failures: ["manual_fallback"],
        severity: item.risk_level === "high" ? "P0" : "P1",
        reason: result.reason,
        model_version: null,
        prompt_version: null,
      });
      continue;
    }
    const failures = [];
    let severity = null;
    if (item.capability === "parseTransaction") {
      const expected = item.expected_structured_output;
      for (const field of ["amount", "type", "occurred_at", "category"]) {
        if (result.value[field] !== expected[field]) failures.push(field);
      }
      const ratio = result.value.amount / expected.amount;
      severity = failures.includes("type") || ratio >= 10 || ratio <= 0.1 ? "P0" : failures.length ? "P1" : null;
    } else if (item.capability === "recommendNature") {
      if (!item.acceptable_labels.includes(result.value.recommended_nature)) failures.push("unacceptable_nature");
      if (item.unacceptable_labels.includes(result.value.recommended_nature)) failures.push("obvious_nature_error");
      severity = failures.length ? "P1" : null;
    } else {
      rows.push({ case_id: item.case_id, status: "skipped", reason: "human_rubric_required" });
      continue;
    }
    rows.push({ case_id: item.case_id, status: failures.length ? "failed" : "passed", failures, severity,
      model_version: result.modelVersion, prompt_version: result.workflowVersion });
  }
  const evaluated = rows.filter((row) => row.status !== "skipped");
  const passed = evaluated.filter((row) => row.status === "passed").length;
  const p0 = evaluated.filter((row) => row.severity === "P0").length;
  return {
    label: "SKELETON_ONLY — smoke fixtures do not establish model accuracy or Beta readiness",
    total: rows.length, evaluated: evaluated.length, skipped: rows.length - evaluated.length,
    passed, failed: evaluated.length - passed, p0,
    accuracy: evaluated.length ? passed / evaluated.length : null,
    p0Rate: evaluated.length ? p0 / evaluated.length : null,
    rows,
  };
}

/** Compare rates only on the same fully evaluated regression set. */
export function regressionGate(baseline, candidate) {
  const ids = (report) => report.rows.map((row) => row.case_id).sort();
  if (baseline.evaluated === 0 || candidate.evaluated === 0 || baseline.skipped || candidate.skipped
    || JSON.stringify(ids(baseline)) !== JSON.stringify(ids(candidate))) {
    return { allowed: false, reason: "incomplete_or_different_dataset" };
  }
  if (candidate.p0Rate > baseline.p0Rate) return { allowed: false, reason: "p0_regression" };
  return { allowed: false, reason: "skeleton_requires_human_review" };
}
