import { hasPeriodReviewIntent, MAX_QUERY_DAYS, resolveLedgerQuery, type QueryContext, type QueryPlan, type QueryResolution } from "./ledger-query.ts";

import { createDateRange } from "./date-range.ts";

export type PeriodReviewResolution = QueryResolution | { kind: "review"; plan: QueryPlan };
const rangeLimitQuestion = `聊天复盘最多支持${MAX_QUERY_DAYS}天；更长范围请到账单选择日期后点复盘这段时间`;

/** A new review starts with all recorded cashflow. Only date and book may carry
 * over from an earlier query; an old dining filter must not narrow the review. */
export function resolvePeriodReview(text: string, context: QueryContext): PeriodReviewResolution {
  if (!hasPeriodReviewIntent(text)) return { kind: "none" };
  const normalized = text.normalize("NFKC").replace(/这段时间|这段日期|这个周期|本周期/g, "当前日期范围").replace(/^继续/, "再");
  const usesSelectedRange = /当前日期范围|所选日期范围|这期|本期|这一期/.test(normalized);
  if (usesSelectedRange) {
    try {
      const selected = createDateRange(context.defaultRange.startDate, context.defaultRange.endDate);
      if ((Date.parse(selected.endDate) - Date.parse(selected.startDate)) / 86_400_000 + 1 > MAX_QUERY_DAYS) {
        return { kind: "clarification", question: rangeLimitQuestion };
      }
    } catch { /* Invalid dates retain the ordinary validation error below. */ }
  }
  const previousQuery = context.previousQuery && { range: { ...(usesSelectedRange ? context.defaultRange : context.previousQuery.range) }, ledgerKind: context.previousQuery.ledgerKind ?? context.ledgerKind, type: "all" as const, metric: "total" as const };
  const resolved = resolveLedgerQuery(normalized, { ...context, previousQuery });
  if (resolved.kind === "none") return { kind: "clarification", question: "复盘只查看已有账目。请先说明要复盘的日期和账本，记账或修改请另外发送。" };
  if (resolved.kind === "clarification" && resolved.question === `一次查询最多支持${MAX_QUERY_DAYS}天，请缩小日期范围`) {
    return { kind: "clarification", question: rangeLimitQuestion };
  }
  if (resolved.kind !== "query") return resolved;
  const plan = resolved.plan;
  // A specifically requested category, count, or calendar-month comparison keeps
  // the normal query semantics; never silently broaden it into a whole-book review.
  if (plan.type !== "all" || plan.metric !== "total" || plan.categories || plan.natures || plan.comparison === "previous_month") return resolved;
  return { kind: "review", plan };
}
