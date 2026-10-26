"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Transaction } from "../lib/domain/types";
import type { DateRange } from "../lib/domain/date-range";
import { cents, localDate, transactionDay } from "../lib/domain/finance";
import { buildPeriodReview, selectPeriodReviewEvidence, type EvidenceSelector, type PeriodReview, type PeriodReviewBreakdown } from "../lib/domain/period-review";
import { StoryIcon } from "./story-icons";
import "./period-review.css";

export type PeriodReviewPanelProps = { transactions: readonly Transaction[]; range: DateRange; ledgerName: string; defaultOpen?: boolean; today?: string };
const PAGE_SIZE = 5;
function moneyFen(fen: number) {
  const value = BigInt(Math.abs(fen));
  const whole = (value / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${fen < 0 ? "−" : ""}¥${whole}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
}
const signedMoneyFen = (fen: number) => `${fen > 0 ? "+" : ""}${moneyFen(fen)}`;
const period = (range: DateRange) => `${range.startDate} 至 ${range.endDate}`;
const change = (fen: number) => fen === 0 ? "不变" : `${fen > 0 ? "增加" : "减少"}${moneyFen(Math.abs(fen))}`;
function comparisonNote(review: PeriodReview) {
  if (review.comparison.status === "available") return `与前一等长时段相比，已记录支出${change(review.comparison.delta.expenseFen)}。`;
  switch (review.comparison.reason) {
    case "no_current_records": return "这段时间还没有记录，暂不比较。";
    case "no_previous_records": return "上一段没有收支记录，暂不比较。没有记录不代表实际收支为零。";
    case "unconfirmed_dates": return "有日期待核对的旧账，核对后再比较。";
    case "out_of_range": return "前一等长时段超出支持的日期范围，暂不比较变化。";
  }
}

export function PeriodReviewPanel({ transactions, range, ledgerName, defaultOpen = false, today = localDate() }: PeriodReviewPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [selection, setSelection] = useState<{ title: string; selector: EvidenceSelector } | null>(null);
  const [page, setPage] = useState(0);
  const [breakdown, setBreakdown] = useState<"category" | "nature">("category");
  const contentId = useId();
  const evidenceRegion = useRef<HTMLElement>(null);
  const evidenceList = useRef<HTMLUListElement>(null);
  const evidenceTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selection) {
      evidenceRegion.current?.focus({ preventScroll: true });
      evidenceRegion.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    } else if (evidenceTrigger.current?.isConnected) {
      const sourceSection = evidenceTrigger.current.closest<HTMLDetailsElement>("details.review-section");
      if (sourceSection) sourceSection.open = true;
      evidenceTrigger.current.focus();
    }
  }, [selection]);
  useEffect(() => { if (evidenceList.current) evidenceList.current.scrollTop = 0; }, [selection, page]);
  const { startDate, endDate } = range;
  const computed = useMemo(() => {
    try { return { review: buildPeriodReview(transactions, { startDate, endDate }, today), error: "" }; }
    catch { return { review: null, error: "这段复盘暂时无法生成，请先核对账目的日期和金额。" }; }
  }, [transactions, startDate, endDate, today]);
  const evidence = useMemo(() => selection ? selectPeriodReviewEvidence(transactions, selection.selector)
    .toSorted((a, b) => transactionDay(b).localeCompare(transactionDay(a)) || a.id.localeCompare(b.id)) : [], [transactions, selection]);
  const showEvidence = (title: string, selector: EvidenceSelector, trigger: HTMLButtonElement) => { evidenceTrigger.current = trigger; setSelection({ title, selector }); setPage(0); };
  const review = computed.review, current = review?.current, previous = review?.previous;
  const top = current?.expenseCategories[0];
  const pages = Math.max(1, Math.ceil(evidence.length / PAGE_SIZE));
  const shown = evidence.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const distribution = (rows: PeriodReviewBreakdown[]) => <div className="review-breakdown-list">
    {rows.filter(row => row.count > 0).map(row => <button key={row.label} onClick={event => showEvidence(`本段 · ${row.label}支出`, row.evidence, event.currentTarget)} aria-label={`查看本段${row.label}支出账目：${moneyFen(row.amountFen)}，${row.count} 笔`}>
      <span>{breakdown === "nature" && row.label === "投资" ? "投资性质支出" : row.label}<small>{row.count} 笔</small></span><b>{moneyFen(row.amountFen)}</b>
    </button>)}
  </div>;
  const totalRows = [{ label: "收入", field: "incomeFen", type: "income" }, { label: "支出", field: "expenseFen", type: "expense" }, { label: "收支差额", field: "balanceFen", type: "all" }] as const;
  return <section className="period-review" data-testid="period-review" aria-label={`${ledgerName}期间复盘`}>
    <button className="period-review-toggle" data-testid="home-action-review" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(value => !value)}>
      <span>复盘这段时间</span><StoryIcon name="arrow" />
    </button>
    {defaultOpen && <p className="period-review-scope">{ledgerName} · {period(range)}</p>}
    {open && <div id={contentId} className="period-review-content">
      {computed.error ? <p role="alert">{computed.error}</p> : review && current && <>
        {current.status === "no_records" ? <p className="review-empty">这段时间还没有记账，等记下几笔，再一起看看。</p> : <>
          <p className="review-conclusion">{top ? <>已记下的支出里，{top.label}花得最多：<button className="review-key-amount" aria-label={`查看这类支出：${top.label}，${moneyFen(top.amountFen)}，${top.count} 笔`} onClick={event => showEvidence(`本段 · ${top.label}支出`, top.evidence, event.currentTarget)}>{moneyFen(top.amountFen)}</button>。</> : <>这段时间记下了 {current.totals.transactionCount} 笔收入，还没有支出记录。</>}</p>
          {(review.currentIncomplete || (review.comparison.status === "unavailable" && review.comparison.reason === "unconfirmed_dates")) && <p className="review-status">{review.currentIncomplete && "这段时间还没结束，先看看已记下的账。"}{review.comparison.status === "unavailable" && review.comparison.reason === "unconfirmed_dates" && "有日期待核对，先核对后再比较。"}</p>}
          <div className="review-sections">
            <details className="review-section" name={`${contentId}-detail`}>
              <summary><span>查看收支</span><small>{current.totals.transactionCount} 笔</small><StoryIcon name="arrow" /></summary>
              <div className="review-totals">{totalRows.map(row => <button key={row.field} aria-label={`查看本段${row.label}账目：${moneyFen(current.totals[row.field])}`} onClick={event => showEvidence(`本段 · ${row.label}`, current.evidence[row.type], event.currentTarget)}><span>{row.label}</span><b>{moneyFen(current.totals[row.field])}</b></button>)}</div>
              <button className="review-text-action" onClick={event => showEvidence("本段 · 全部收支", current.evidence.all, event.currentTarget)}>查看本段全部账目</button>
            </details>
            <details className="review-section period-review-comparison" name={`${contentId}-detail`}>
              <summary><span>与上一段比较</span><StoryIcon name="arrow" /></summary>
              {previous && <p className="review-context">上一段 {period(previous.range)}（同为 {previous.dayCount} 天）</p>}
              <p className="review-comparison-note">{comparisonNote(review)}</p>
              {review.currentIncomplete && <p className="review-context">仅比较已记录账目，不代表完整时段的变化。</p>}
              {review.comparison.status === "available" && previous && <table aria-label="本段与前段收支比较">
                <thead><tr><th scope="col">项目</th><th scope="col">本段</th><th scope="col">上一段</th><th scope="col">变化</th></tr></thead>
                <tbody>{totalRows.map(row => <tr key={row.field}>
                  <th scope="row">{row.label}</th><td><button aria-label={`查看本段${row.label}账目：${moneyFen(current.totals[row.field])}`} onClick={event => showEvidence(`本段 · ${row.label}`, current.evidence[row.type], event.currentTarget)}>{moneyFen(current.totals[row.field])}</button></td>
                  <td><button aria-label={`查看前段${row.label}账目：${moneyFen(previous.totals[row.field])}`} onClick={event => showEvidence(`前段 · ${row.label}`, previous.evidence[row.type], event.currentTarget)}>{moneyFen(previous.totals[row.field])}</button></td>
                  <td>{signedMoneyFen(review.comparison.status === "available" ? review.comparison.delta[row.field] : 0)}</td>
                </tr>)}</tbody>
              </table>}
            </details>
            <details className="review-section" name={`${contentId}-detail`}>
              <summary><span>花在哪里</span><StoryIcon name="arrow" /></summary>
              {top ? <><div className="review-breakdown-switch" role="group" aria-label="支出分布方式"><button aria-pressed={breakdown === "category"} onClick={() => setBreakdown("category")}>按分类</button><button aria-pressed={breakdown === "nature"} onClick={() => setBreakdown("nature")}>按性质</button></div>{distribution(breakdown === "category" ? current.expenseCategories : current.expenseNatures)}</> : <p className="review-context">这段时间没有已记录的支出。</p>}
            </details>
          </div>
        </>}
        {selection && <section ref={evidenceRegion} tabIndex={-1} className="period-review-evidence" aria-label="复盘账目依据">
          <div className="review-evidence-heading"><h3>{selection.title}</h3><button onClick={() => setSelection(null)}>收起账目依据</button></div>
          <p className="helper">{ledgerName} · {period(selection.selector.range)}<br />共 {evidence.length} 笔 · 只读查看</p>
          {shown.length ? <ul ref={evidenceList} className="review-evidence-list">{shown.map(tx => <li key={tx.id}>
            <div><time dateTime={transactionDay(tx)}>{transactionDay(tx)}</time><strong>{tx.type === "income" ? "+" : "−"}{moneyFen(cents(tx.amount))}</strong></div>
            <p>{tx.note || tx.category}</p><small>{tx.category} · {tx.type === "income" ? "收入" : tx.nature ?? "未分类"}{(tx.dateNeedsConfirmation || tx.date.length > 10) && " · 日期待核对"}</small>
          </li>)}</ul> : <p>这个条件下没有已记录的账目。</p>}
          {evidence.length > PAGE_SIZE && <nav className="review-evidence-pages" aria-label="账目依据分页"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页依据</button><span aria-live="polite">第 {page + 1} / {pages} 页</span><button disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>下一页依据</button></nav>}
        </section>}
        {current.status !== "no_records" && <details className="review-method"><summary>关于这份复盘</summary><p>只说明已记录的收支；没有记录不代表实际收支为零。收支差额不是账户余额或可用预算。投资性质支出不代表投资收益。</p>{review.comparison.status === "unavailable" && review.comparison.reason === "unconfirmed_dates" && <p>日期待核对的旧账暂按设备日期计入。</p>}</details>}
      </>}
    </div>}
  </section>;
}
