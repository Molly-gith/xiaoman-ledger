"use client";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { SalaryBudgetSettings, Transaction } from "../lib/domain/types";
import { allocateSalaryBudget, calculateSalaryBudget, normalizeSalaryBudgetSettings } from "../lib/domain/salary-budget";
import type { DateRange } from "../lib/domain/date-range";
import { cents } from "../lib/domain/finance";
import { StoryIcon } from "./story-icons";
import "./salary-budget.css";

type Summary = NonNullable<ReturnType<typeof calculateSalaryBudget>>;
type Save = (settings: SalaryBudgetSettings | null) => Promise<boolean>;
export type SalaryBudgetPanelProps = {
  settings: SalaryBudgetSettings | null;
  transactions: readonly Transaction[];
  today: string;
  ledgerName: string;
  onSave: Save;
  onViewRecords?: (range: DateRange) => void;
};
const NATURES = ["消费", "浪费", "投资"] as const;
function moneyFen(fen: number) {
  const value = BigInt(Math.abs(fen));
  const whole = (value / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (fen < 0 ? "−" : "") + "¥" + whole + "." + (value % BigInt(100)).toString().padStart(2, "0");
}
function amount(value: string, label: string) {
  if (!value.trim()) throw new Error("请填写" + label + "，没有时可以填 0。");
  const parsed = Number(value);
  cents(parsed);
  return parsed;
}
function rowNote(row: Summary["rows"][number]) {

  if (row.status === "over") return "已超出 " + moneyFen(-row.remainingFen) + "，可以留意后续支出";
  if (row.status === "near") return "已用到预算的八成或以上，可以留意后续支出";
  return "";
}

export function SalaryBudgetPanel({ settings, transactions, today, ledgerName, onSave, onViewRecords }: SalaryBudgetPanelProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saving = useRef(false);
  const summaryButton = useRef<HTMLElement>(null);
  const settingsId = useId();
  const adjustmentId = useId();
  const computed = useMemo(() => {
    try { return { summary: calculateSalaryBudget(settings, transactions, today), error: "" }; }
    catch { return { summary: null, error: "暂时无法计算预算，请核对薪资设置和账目的日期、金额。" }; }
  }, [settings, transactions, today]);
  const summary = computed.summary;
  const enabled = !!settings?.enabled;
  const hasAlert = summary?.rows.some(row => row.status === "near" || row.status === "over");
  const pendingReasons = summary ? [summary.pendingDateCount ? summary.pendingDateCount + " 笔日期待核对" : "", summary.unclassifiedCount ? summary.unclassifiedCount + " 笔未设置性质" : ""].filter(Boolean).join("、") : "";
  async function persist(next: SalaryBudgetSettings | null) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setSaveError("");
    try {
      const saved = await onSave(next);
      if (!saved) {
        setSaveError("这次未能保存，填写内容已保留，请稍后重试。");
        return false;
      }
      setEditing(false);
      setAdjusting(false);
      setOpen(!!next?.enabled);
      requestAnimationFrame(() => summaryButton.current?.focus());
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "这次未能保存，填写内容已保留，请稍后重试。");
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return <details className="salary-budget" data-testid="salary-budget" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary ref={summaryButton} className="salary-budget-toggle">
      <span>薪资预算{!enabled && <small> · 选填</small>}</span>
      <span className="salary-budget-toggle-end">{enabled && <small>{computed.error || summary?.alertsSuppressed ? "待核对" : hasAlert ? "有提醒" : "已启用"}</small>}<StoryIcon name="arrow" /></span>
    </summary>
    <div className="salary-budget-content" aria-busy={busy}>
      {!enabled ? <>
        <p className="salary-budget-intro">想按薪资安排花费时再开启，不设置也可以照常记账。</p>
        <SalaryBudgetForm key={JSON.stringify(settings)} settings={settings} busy={busy} onSave={persist} />
      </> : <>
        {summary && <>
          <p className="salary-budget-scope">{ledgerName} · {summary.range.startDate} 至 {summary.range.endDate}</p>
          <p className="salary-budget-base">本期薪资 <strong>{moneyFen(summary.baseFen)}</strong>{summary.overrideApplied && <span> · 仅本期调整</span>}</p>
          {summary.alertsSuppressed && <p className="salary-budget-caveat">有 {pendingReasons}的支出，暂未计入下面的已用金额；核对前不判断是否接近或超出预算。</p>}
          <dl className="salary-budget-rows">{summary.rows.map(row => <div key={row.nature} className={"salary-budget-row salary-budget-row-" + row.status}>
            <dt>{row.nature}</dt>
            <dd><div className="salary-budget-amounts"><span>已用 <strong>{moneyFen(row.spentFen)}</strong></span><span>额度 {moneyFen(row.budgetFen)}</span></div>{rowNote(row) && <p>{rowNote(row)}</p>}</dd>
          </div>)}</dl>
          {summary.unallocatedFen > 0 && <p className="salary-budget-unallocated">另有 {moneyFen(summary.unallocatedFen)} 未分配，先留着也可以。</p>}
        </>}
        {computed.error && <p className="salary-budget-error" role="alert">{computed.error}</p>}
        <div className="salary-budget-tools">
          {summary && onViewRecords && <button type="button" disabled={busy} onClick={() => onViewRecords(summary.range)}>查看本期账目</button>}
          <button type="button" disabled={busy} aria-expanded={editing} aria-controls={settingsId} onClick={() => { setEditing(value => !value); setAdjusting(false); setSaveError(""); }}>{editing ? "收起设置" : "调整薪资与比例"}</button>
          {summary && <button type="button" disabled={busy} aria-expanded={adjusting} aria-controls={adjustmentId} onClick={() => { setAdjusting(value => !value); setEditing(false); setSaveError(""); }}>{adjusting ? "收起本期调整" : "仅调整本期薪资"}</button>}
        </div>
        {editing && <div id={settingsId} className="salary-budget-editor"><SalaryBudgetForm key={JSON.stringify(settings)} settings={settings} busy={busy} onSave={persist} /></div>}
        {adjusting && summary && settings && <div id={adjustmentId} className="salary-budget-editor"><CurrentSalaryForm key={`${JSON.stringify(settings)}:${summary.range.startDate}:${summary.range.endDate}`} settings={settings} summary={summary} busy={busy} onSave={persist} /></div>}
        <details className="salary-budget-explanation">
          <summary>预算和投资怎样计算？</summary>
          <p>预算是你按预计薪资做的计划，不是账户余额。这里按本期已记录支出的日期与性质统计；接近或超过预算只作提醒，不会阻止记账。</p>
          <p>“投资”只统计性质为投资的支出，不包含资产账户转入、转出、市值或收益。设置薪资和调整本期薪资，都不会新增收入账目。</p>
        </details>
      </>}
      {saveError && <p className="salary-budget-error" role="alert">{saveError}</p>}
    </div>
  </details>;
}

function SalaryBudgetForm({ settings, busy, onSave }: { settings: SalaryBudgetSettings | null; busy: boolean; onSave: Save }) {
  const [salary, setSalary] = useState(settings ? String(settings.expectedSalary) : "");
  const [percentages, setPercentages] = useState<Record<(typeof NATURES)[number], string>>({
    消费: settings ? String(settings.percentages.消费) : "",
    浪费: settings ? String(settings.percentages.浪费) : "0",
    投资: settings ? String(settings.percentages.投资) : "",
  });
  const [salaryDay, setSalaryDay] = useState(settings?.salaryDay ? String(settings.salaryDay) : "");
  const [periodMode, setPeriodMode] = useState<SalaryBudgetSettings["periodMode"]>(settings?.periodMode ?? "calendar_month");
  const [error, setError] = useState("");
  const distributionId = useId();
  const cycleHintId = useId();
  const sum = NATURES.reduce((total, nature) => total + Number(percentages[nature] || 0), 0);
  const validSum = Number.isFinite(sum) && sum >= 0 && sum <= 100;
  const remainingPercent = Math.round((100 - sum) * 100) / 100;
  const allocation = useMemo(() => {
    if (!salary.trim()) return null;
    try { return allocateSalaryBudget(Number(salary), { 消费: Number(percentages.消费 || 0), 浪费: Number(percentages.浪费 || 0), 投资: Number(percentages.投资 || 0) }); }
    catch { return null; }
  }, [salary, percentages]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      const expectedSalary = amount(salary, "预计每月薪资");
      const split = { 消费: amount(percentages.消费, "消费比例"), 浪费: amount(percentages.浪费, "浪费比例"), 投资: amount(percentages.投资, "投资比例") };
      const nextSalaryDay = salaryDay ? Number(salaryDay) : null;
      const sameCycle = settings?.periodMode === periodMode && (periodMode === "calendar_month" || settings?.salaryDay === nextSalaryDay);
      const next = normalizeSalaryBudgetSettings({
        enabled: true,
        expectedSalary,
        percentages: split,
        salaryDay: nextSalaryDay,
        periodMode,
        periodOverride: sameCycle ? settings?.periodOverride ?? null : null,
      });
      if (!next) throw new Error("请检查薪资预算设置后再保存。");
      await onSave(next);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "请检查填写内容后再保存。");
    }
  }
  return <form className="salary-budget-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      <label className="salary-budget-field">预计每月薪资（元，必填）
        <input name="expectedSalary" type="number" inputMode="decimal" min="0" max="999999999999.99" step="0.01" required value={salary} onChange={event => setSalary(event.target.value)} placeholder="填写你预计拿到的薪资" />
      </label>
      <fieldset className="salary-budget-percentages" aria-describedby={distributionId}>
        <legend>分配比例（必填，可填 0）</legend>
        <div>{NATURES.map(nature => <div key={nature} className="salary-budget-percentage-field"><label>{nature}（%）<input name={"salaryBudgetPercent-" + nature} type="number" inputMode="decimal" min="0" max="100" step="0.01" required value={percentages[nature]} onChange={event => setPercentages(current => ({ ...current, [nature]: event.target.value }))} /></label>{allocation && <output aria-label={nature + "预算金额"}>{moneyFen(allocation.amountsFen[nature])}</output>}</div>)}</div>
        <p id={distributionId} className={validSum ? "salary-budget-helper" : "salary-budget-error"}>{validSum ? "合计 " + (Math.round(sum * 100) / 100) + "%，未分配 " + remainingPercent + "%" + (allocation ? "（" + moneyFen(allocation.unallocatedFen) + "）" : "") + "。不必凑满 100%。" : "三项比例合计不能超过 100%，请调低后再保存。"}</p>
      </fieldset>
      <details className="salary-budget-cycle">
        <summary>周期选项 <span>{periodMode === "calendar_month" ? "默认自然月" : "按发薪日"}</span></summary>
        <label className="salary-budget-field">发薪日（选填）
          <select name="salaryDay" value={salaryDay} onChange={event => { setSalaryDay(event.target.value); if (!event.target.value) setPeriodMode("calendar_month"); }} aria-describedby={cycleHintId}>
            <option value="">未设置</option>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>每月 {index + 1} 日</option>)}
          </select>
        </label>
        <label className="salary-budget-cycle-choice"><input name="salaryBudgetPeriod" type="checkbox" checked={periodMode === "salary_based"} disabled={!salaryDay || busy} onChange={event => setPeriodMode(event.target.checked ? "salary_based" : "calendar_month")} /><span>按发薪日划分预算周期（选用）</span></label>
        <p id={cycleHintId} className="salary-budget-helper">{periodMode === "salary_based" ? "从发薪日到下次发薪日前一天；遇到没有该日的月份，按月末计算。" : "未选用时，按每月 1 日至月底计算。设置发薪日后可以选用工资周期。"}</p>
      </details>
      {!!settings?.periodOverride && <p className="salary-budget-helper">已设置的本期临时薪资优先使用；预计薪资用于其他周期。改变周期时会清除本期临时调整。</p>}
      {error && <p className="salary-budget-error" role="alert">{error}</p>}
      <div className="salary-budget-form-actions">
        <button className="salary-budget-save" type="submit">{busy ? "保存中…" : settings?.enabled ? "保存预算设置" : "保存并启用"}</button>
        {settings?.enabled && <button className="salary-budget-stop" type="button" onClick={() => void onSave({ ...settings, enabled: false })}>停用薪资预算</button>}
      </div>
    </fieldset>
  </form>;
}

function CurrentSalaryForm({ settings, summary, busy, onSave }: { settings: SalaryBudgetSettings; summary: Summary; busy: boolean; onSave: Save }) {
  const [salary, setSalary] = useState(String(summary.baseFen / 100));
  const [error, setError] = useState("");
  const hintId = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      const next = normalizeSalaryBudgetSettings({ ...settings, periodOverride: { ...summary.range, salary: amount(salary, "本期薪资") } });
      if (!next) throw new Error("请检查本期薪资后再保存。");
      await onSave(next);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "请检查本期薪资后再保存。"); }
  }
  return <form className="salary-budget-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      <label className="salary-budget-field">本期薪资（元，必填）
        <input name="currentPeriodSalary" type="number" inputMode="decimal" min="0" max="999999999999.99" step="0.01" required value={salary} onChange={event => setSalary(event.target.value)} aria-describedby={hintId} />
      </label>
      <p id={hintId} className="salary-budget-helper">仅用于 {summary.range.startDate} 至 {summary.range.endDate}，按原比例重算预算。下期恢复预计薪资 {moneyFen(cents(settings.expectedSalary))}，不会新增收入账目。</p>
      {error && <p className="salary-budget-error" role="alert">{error}</p>}
      <div className="salary-budget-form-actions">
        <button className="salary-budget-save" type="submit">{busy ? "保存中…" : "仅保存本期薪资"}</button>
        {summary.overrideApplied && <button type="button" onClick={() => void onSave({ ...settings, periodOverride: null })}>恢复预计薪资</button>}
      </div>
    </fieldset>
  </form>;
}
