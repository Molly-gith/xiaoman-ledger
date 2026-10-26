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
    case "no_current_records": return "本段没有已记录的收支，暂不比较变化。";
    case "no_previous_records": return "前段没有收支记录，暂不比较变化；不代表当时实际收支为零。";
    case "unconfirmed_dates": return "本段或前段有日期待核对的旧账，当前按设备日期暂计，核对前不比较变化。";
    case "out_of_range": return "前一等长时段超出支持的日期范围，暂不比较变化。";
  }
}

export function PeriodReviewPanel({ transactions, range, ledgerName, defaultOpen = false, today = localDate() }: PeriodReviewPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [selection, setSelection] = useState<{ title: string; selector: EvidenceSelector } | null>(null);
  const [page, setPage] = useState(0);
  const contentId = useId();
  const evidenceRegion = useRef<HTMLElement>(null);
  const evidenceList = useRef<HTMLUListElement>(null);
  const evidenceTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selection) {
      evidenceRegion.current?.focus({ preventScroll: true });
      evidenceRegion.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    } else if (evidenceTrigger.current?.isConnected) evidenceTrigger.current.focus();
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
  const distribution = (title: string, rows: PeriodReviewBreakdown[]) => <details className="period-review-distribution">
    <summary>{title}</summary>
    <div className="review-breakdown-list">{rows.length ? rows.map(row => <button key={row.label} disabled={row.count === 0} onClick={event => showEvidence(`本段 · ${row.label}支出`, row.evidence, event.currentTarget)} aria-label={`查看本段${row.label}支出账目：${moneyFen(row.amountFen)}，${row.count} 笔`}>
      <span>{row.label === "投资" ? "投资性质支出" : row.label}</span><span><b>{moneyFen(row.amountFen)}</b><small>{row.count} 笔{row.count > 0 ? " · 查看账目" : ""}</small></span>
    </button>) : <p>这段时间没有已记录的支出。</p>}</div>
  </details>;
  return <section className="period-review" data-testid="period-review" aria-label={`${ledgerName}期间复盘`}>
    <button className="period-review-toggle" data-testid="home-action-review" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(value => !value)}>
      <span>复盘这段时间</span><StoryIcon name="arrow" />
    </button>
    <p className="period-review-scope">{ledgerName} · {period(range)}</p>
    {open && <div id={contentId} className="period-review-content">
      {computed.error ? <p role="alert">{computed.error}</p> : review && current && <>
        <ul className="period-review-insights" aria-label="这段时间的三条事实">
          <li><p>{current.status === "no_records" ? "这段时间还没有记账，不能把实际收支当作零。" : `已记录 ${current.totals.transactionCount} 笔：收入${moneyFen(current.totals.incomeFen)}，支出${moneyFen(current.totals.expenseFen)}，收支差额${moneyFen(current.totals.balanceFen)}。`}</p>
            {current.totals.transactionCount > 0 && <button onClick={event => showEvidence("本段 · 全部收支", current.evidence.all, event.currentTarget)}>查看本段全部账目</button>}</li>
          <li><p>{top ? `支出较多的一类是${top.label}：${moneyFen(top.amountFen)}（${top.count} 笔）。` : "没有支出记录，暂不分析花费分布。"}</p>
            {top && <button onClick={event => showEvidence(`本段 · ${top.label}支出`, top.evidence, event.currentTarget)}>查看这类支出</button>}</li>
          <li><p>{comparisonNote(review)}</p></li>
        </ul>
        <div className="period-review-comparison">
          <h3>与前一等长时段比较</h3>
          <p className="helper">本段 {period(current.range)} · {current.dayCount} 天{previous && <><br />前段 {period(previous.range)} · {previous.dayCount} 天</>}</p>
          {review.currentIncomplete && <p className="review-incomplete">所选时段尚未结束，仅比较已记录账目，不能当作完整时段的变化。</p>}
          {review.comparison.status === "available" && previous ? <table aria-label="本段与前段收支比较">
            <thead><tr><th scope="col">项目</th><th scope="col">本段</th><th scope="col">前段</th><th scope="col">变化</th></tr></thead>
            <tbody>{([{ label: "收入", field: "incomeFen", type: "income" }, { label: "支出", field: "expenseFen", type: "expense" }, { label: "收支差额", field: "balanceFen", type: "all" }] as const).map(row => <tr key={row.field}>
              <th scope="row">{row.label}</th><td><button aria-label={`查看本段${row.label}账目：${moneyFen(current.totals[row.field])}`} onClick={event => showEvidence(`本段 · ${row.label}`, current.evidence[row.type], event.currentTarget)}>{moneyFen(current.totals[row.field])}</button></td>
              <td><button aria-label={`查看前段${row.label}账目：${moneyFen(previous.totals[row.field])}`} onClick={event => showEvidence(`前段 · ${row.label}`, previous.evidence[row.type], event.currentTarget)}>{moneyFen(previous.totals[row.field])}</button></td>
              <td>{signedMoneyFen(review.comparison.status === "available" ? review.comparison.delta[row.field] : 0)}</td>
            </tr>)}</tbody>
          </table> : <p className="review-no-comparison">暂无可比较的变化。</p>}
        </div>
        {distribution("按分类看支出", current.expenseCategories)}
        {distribution("按性质看支出", current.expenseNatures)}
        {selection && <section ref={evidenceRegion} tabIndex={-1} className="period-review-evidence" aria-label="复盘账目依据">
          <div className="review-evidence-heading"><h3>{selection.title}</h3><button onClick={() => setSelection(null)}>收起账目依据</button></div>
          <p className="helper">{ledgerName} · {period(selection.selector.range)}<br />共 {evidence.length} 笔 · 只读查看</p>
          {shown.length ? <ul ref={evidenceList} className="review-evidence-list">{shown.map(tx => <li key={tx.id}>
            <div><time dateTime={transactionDay(tx)}>{transactionDay(tx)}</time><strong>{tx.type === "income" ? "+" : "−"}{moneyFen(cents(tx.amount))}</strong></div>
            <p>{tx.note || tx.category}</p><small>{tx.category} · {tx.type === "income" ? "收入" : tx.nature ?? "未分类"}{(tx.dateNeedsConfirmation || tx.date.length > 10) && " · 日期待核对"}</small>
          </li>)}</ul> : <p>这个条件下没有已记录的账目。</p>}
          {evidence.length > PAGE_SIZE && <nav className="review-evidence-pages" aria-label="账目依据分页"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页依据</button><span aria-live="polite">第 {page + 1} / {pages} 页</span><button disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>下一页依据</button></nav>}
        </section>}
        <p className="period-review-limit">只说明已记录的收支；收支差额不是账户余额或可用预算。投资性质支出不代表投资收益。</p>
      </>}
    </div>}
  </section>;
}
