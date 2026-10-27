"use client";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { SalaryBudgetSettings, Transaction } from "../lib/domain/types";
import { allocateSalaryBudget, allocateSalaryBudgetAmounts, calculateSalaryBudget, normalizeSalaryBudgetSettings } from "../lib/domain/salary-budget";
import type { DateRange } from "../lib/domain/date-range";
import { cents } from "../lib/domain/finance";
import { recurringSalaryToday } from "../lib/domain/recurring-salary";
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
  autoSalaryExecution?: "on_open" | "background";
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

export function SalaryBudgetPanel({ settings, transactions, today, ledgerName, onSave, onViewRecords, autoSalaryExecution = "on_open" }: SalaryBudgetPanelProps) {
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
  const settingsKey = JSON.stringify(settings, (key, value) => key === "lastProcessedMonth" ? undefined : value);
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
        <SalaryBudgetForm key={settingsKey} settings={settings} autoSalaryExecution={autoSalaryExecution} busy={busy} onSave={persist} />
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
          <button type="button" disabled={busy} aria-expanded={editing} aria-controls={settingsId} onClick={() => { setEditing(value => !value); setAdjusting(false); setSaveError(""); }}>{editing ? "收起设置" : "调整薪资与金额"}</button>
          {summary && <button type="button" disabled={busy} aria-expanded={adjusting} aria-controls={adjustmentId} onClick={() => { setAdjusting(value => !value); setEditing(false); setSaveError(""); }}>{adjusting ? "收起本期调整" : "仅调整本期薪资"}</button>}
        </div>
        {editing && <div id={settingsId} className="salary-budget-editor"><SalaryBudgetForm key={settingsKey} settings={settings} autoSalaryExecution={autoSalaryExecution} busy={busy} onSave={persist} /></div>}
        {adjusting && summary && settings && <div id={adjustmentId} className="salary-budget-editor"><CurrentSalaryForm key={`${settingsKey}:${summary.range.startDate}:${summary.range.endDate}`} settings={settings} summary={summary} busy={busy} onSave={persist} /></div>}
        <details className="salary-budget-explanation">
          <summary>预算和投资怎样计算？</summary>
          <p>预算是你按预计薪资做的计划，不是账户余额。这里按本期已记录支出的日期与性质统计；接近或超过预算只作提醒，不会阻止记账。</p>
          <p>“投资”只统计性质为投资的支出，不包含资产账户转入、转出、市值或收益。预算金额和本期调整只影响预算；自动记工资需单独选用。</p>
        </details>
      </>}
      {saveError && <p className="salary-budget-error" role="alert">{saveError}</p>}
    </div>
  </details>;
}

function SalaryBudgetForm({ settings, autoSalaryExecution, busy, onSave }: {
  settings: SalaryBudgetSettings | null; autoSalaryExecution: "on_open" | "background"; busy: boolean; onSave: Save;
}) {
  const initialPercentages = settings?.percentages ?? { 消费: 70, 浪费: 5, 投资: 25 };
  const initialAllocation = settings
    ? settings.amounts ?? Object.fromEntries(NATURES.map(nature => [nature, allocateSalaryBudget(settings.expectedSalary, settings.percentages).amountsFen[nature] / 100])) as Record<(typeof NATURES)[number], number>
    : { 消费: 0, 浪费: 0, 投资: 0 };
  const [salary, setSalary] = useState(settings ? String(settings.expectedSalary) : "");
  const [amounts, setAmounts] = useState<Record<(typeof NATURES)[number], string>>(() => ({
    消费: String(initialAllocation.消费), 浪费: String(initialAllocation.浪费), 投资: String(initialAllocation.投资),
  }));
  const [editedAmounts, setEditedAmounts] = useState<Record<(typeof NATURES)[number], boolean>>({ 消费: false, 浪费: false, 投资: false });
  const [salaryDay, setSalaryDay] = useState(settings?.salaryDay ? String(settings.salaryDay) : "");
  const [periodMode, setPeriodMode] = useState<SalaryBudgetSettings["periodMode"]>(settings?.periodMode ?? "calendar_month");
  const [automaticIncome, setAutomaticIncome] = useState(settings?.autoIncome?.enabled ?? false);
  const [error, setError] = useState("");
  const distributionId = useId();
  const amountHintId = useId();
  const cycleHintId = useId();
  const automaticHintId = useId();
  function validFen(value: string): number | null {
    if (!value.trim()) return null;
    try { return cents(Number(value)); } catch { return null; }
  }
  const salaryFen = validFen(salary);
  const canAllocate = salaryFen !== null && salaryFen > 0;
  const visibleAmounts = canAllocate ? amounts : { 消费: "0", 浪费: "0", 投资: "0" };
  const parsedAmounts = NATURES.map(nature => validFen(visibleAmounts[nature]));
  const totalFen = parsedAmounts.every(value => value !== null) ? parsedAmounts.reduce<number>((total, value) => total + (value ?? 0), 0) : null;
  const overAllocated = salaryFen !== null && totalFen !== null && totalFen > salaryFen;
  const canRecordIncome = !!salaryDay && canAllocate;
  const recordIncome = automaticIncome && canRecordIncome;
  const hasManualAmounts = NATURES.some(nature => editedAmounts[nature]);
  function displayPercent(nature: (typeof NATURES)[number]) {
    const currentFen = validFen(visibleAmounts[nature]);
    if (canAllocate && currentFen !== null) return String(Math.round(currentFen / salaryFen * 10000) / 100);
    if (settings && settings.expectedSalary > 0) return String(Math.round(cents(initialAllocation[nature]) / cents(settings.expectedSalary) * 10000) / 100);
    return String(initialPercentages[nature]);
  }
  function changeSalary(value: string) {
    setSalary(value);
    const nextFen = validFen(value);
    if (nextFen === null || nextFen === 0) return;
    const nextSalary = nextFen / 100;
    const allocation = settings && settings.expectedSalary > 0
      ? allocateSalaryBudgetAmounts(settings.expectedSalary, initialAllocation, nextSalary)
      : allocateSalaryBudget(nextSalary, initialPercentages);
    setAmounts(current => ({
      消费: editedAmounts.消费 ? current.消费 : String(allocation.amountsFen.消费 / 100),
      浪费: editedAmounts.浪费 ? current.浪费 : String(allocation.amountsFen.浪费 / 100),
      投资: editedAmounts.投资 ? current.投资 : String(allocation.amountsFen.投资 / 100),
    }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      const expectedSalary = amount(salary, "每月到手工资");
      const exactAmounts = { 消费: amount(visibleAmounts.消费, "消费预算金额"), 浪费: amount(visibleAmounts.浪费, "浪费预算金额"), 投资: amount(visibleAmounts.投资, "投资预算金额") };
      const nextSalaryDay = salaryDay ? Number(salaryDay) : null;
      const sameCycle = settings?.periodMode === periodMode && (periodMode === "calendar_month" || settings?.salaryDay === nextSalaryDay);
      const autoIncome = settings?.autoIncome
        ? { ...settings.autoIncome, enabled: recordIncome }
        : recordIncome ? { enabled: true, startDate: recurringSalaryToday(), lastProcessedMonth: null } : undefined;
      const next = normalizeSalaryBudgetSettings({
        enabled: true,
        expectedSalary,
        amounts: exactAmounts,
        percentages: initialPercentages,
        salaryDay: nextSalaryDay,
        periodMode,
        periodOverride: sameCycle ? settings?.periodOverride ?? null : null,
        ...(autoIncome ? { autoIncome } : {}),
      });
      if (!next) throw new Error("请检查薪资预算设置后再保存。");
      await onSave(next);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "请检查填写内容后再保存。");
    }
  }
  return <form className="salary-budget-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      <label className="salary-budget-field">每月到手工资（元，必填）
        <input name="expectedSalary" type="number" inputMode="decimal" min="0" max="999999999999.99" step="0.01" required value={salary} onChange={event => changeSalary(event.target.value)} placeholder="填写你预计拿到的工资" />
      </label>
      <fieldset className="salary-budget-percentages" aria-describedby={distributionId + " " + amountHintId}>
        <legend>预算金额（元，可修改）</legend>
        <div>{NATURES.map(nature => <div key={nature} className="salary-budget-percentage-field"><label><span>{nature}（{displayPercent(nature)}%）</span><input aria-label={nature + "预算金额（元）"} name={"salaryBudgetAmount-" + nature} type="number" inputMode="decimal" min="0" max="999999999999.99" step="0.01" required disabled={!canAllocate || busy} value={visibleAmounts[nature]} onChange={event => { setAmounts(current => ({ ...current, [nature]: event.target.value })); setEditedAmounts(current => ({ ...current, [nature]: true })); }} /></label></div>)}</div>
        <p id={distributionId} className={overAllocated ? "salary-budget-error" : "salary-budget-helper"}>{overAllocated
          ? "分配金额超过工资 " + moneyFen(totalFen! - salaryFen!) + "，请调低后再保存。"
          : totalFen === null ? "请填写有效金额，最多两位小数。"
            : "已分配 " + moneyFen(totalFen) + "，未分配 " + moneyFen(Math.max(0, (salaryFen ?? 0) - totalFen)) + "。"}</p>
        <p id={amountHintId} className="salary-budget-helper salary-budget-edit-hint">{hasManualAmounts ? "你手改的金额会保留，其余随工资更新。" : "填工资后自动预估，金额可以直接改，浪费可设为 0。"}</p>
      </fieldset>
      <details className="salary-budget-cycle">
        <summary>发薪与周期选项 <span>{periodMode === "calendar_month" ? "默认自然月" : "按发薪日"}</span></summary>
        <label className="salary-budget-field">发薪日（选填）
          <select name="salaryDay" value={salaryDay} onChange={event => { setSalaryDay(event.target.value); if (!event.target.value) setPeriodMode("calendar_month"); }} aria-describedby={cycleHintId}>
            <option value="">未设置</option>{Array.from({ length: 31 }, (_, index) => <option value={index + 1} key={index + 1}>每月 {index + 1} 日</option>)}
          </select>
        </label>
        <div className="salary-budget-automatic">
          <label className="salary-budget-cycle-choice"><input name="salaryBudgetAutoIncome" type="checkbox" checked={recordIncome} disabled={!canRecordIncome || busy} onChange={event => setAutomaticIncome(event.target.checked)} aria-describedby={automaticHintId} /><span>发薪日自动记工资（选用）</span></label>
          <p id={automaticHintId} className="salary-budget-helper">{!canRecordIncome ? "设置发薪日和大于 0 的工资后，可开启。" : recordIncome
            ? "按北京时间，在启用后到期的发薪日按设置金额记入；到账有变化可改账，无需每月确认。"
            : "选用后，发薪日会记一笔工资收入。"}</p>
          {recordIncome && <p className="salary-budget-helper salary-budget-edit-hint">{autoSalaryExecution === "background" ? "由账号后台自动记入，预算也会按设置换期。" : "网页关闭后，下次打开会补记到期工资；预算按设置换期。"}</p>}
        </div>
        <label className="salary-budget-cycle-choice"><input name="salaryBudgetPeriod" type="checkbox" checked={periodMode === "salary_based"} disabled={!salaryDay || busy} onChange={event => setPeriodMode(event.target.checked ? "salary_based" : "calendar_month")} /><span>按发薪周期计算预算（选用）</span></label>
        <p id={cycleHintId} className="salary-budget-helper">{periodMode === "salary_based" ? "从发薪日到下次发薪日前一天，短月按月末。保存后可在「账单 → 发薪周期」查看。" : "未选用时按自然月计算。设置发薪日后，「账单」也会提供「发薪周期」。"}</p>
      </details>
      {!!settings?.periodOverride && <p className="salary-budget-helper">已设置的本期临时薪资优先用于预算；改变周期时会清除本期临时调整。</p>}
      {error && <p className="salary-budget-error" role="alert">{error}</p>}
      <div className="salary-budget-form-actions">
        <button className="salary-budget-save" type="submit">{busy ? "保存中…" : settings?.enabled ? "保存预算设置" : "保存并启用"}</button>
        {settings?.enabled && <button className="salary-budget-stop" type="button" onClick={() => void onSave({ ...settings, enabled: false, ...(settings.autoIncome ? { autoIncome: { ...settings.autoIncome, enabled: false } } : {}) })}>停用薪资预算</button>}
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
      <p id={hintId} className="salary-budget-helper">仅用于 {summary.range.startDate} 至 {summary.range.endDate}，按已保存分配重算预算。下期恢复预计薪资 {moneyFen(cents(settings.expectedSalary))}；这项调整不会新增收入，也不改变自动记工资金额。</p>
      {error && <p className="salary-budget-error" role="alert">{error}</p>}
      <div className="salary-budget-form-actions">
        <button className="salary-budget-save" type="submit">{busy ? "保存中…" : "仅保存本期薪资"}</button>
        {summary.overrideApplied && <button type="button" onClick={() => void onSave({ ...settings, periodOverride: null })}>恢复预计薪资</button>}
      </div>
    </fieldset>
  </form>;
}
