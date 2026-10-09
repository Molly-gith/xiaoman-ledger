"use client";
import { useState, type FormEvent } from "react";
import type { BudgetPlan, CycleType, ExpenseNature, FinancialCycle, FundingSource, FundingSourceType, Transaction } from "../lib/domain/types";
import { calendarMonthCycle, cents, customCycle, salaryCycle, transactionDay } from "../lib/domain/finance";
import { CATEGORY_ICONS, EXPENSE_CATEGORIES, classifyTransaction, type LedgerCategory } from "../lib/classify";
import { suggestBudget } from '../lib/domain/budget-suggestion';
import { money } from './ledger-components';
import { StoryIcon, categoryIcon } from './story-icons';
import { VoiceNote } from './voice-note';

const FUNDING_SOURCE_OPTIONS: { value: FundingSourceType; label: string }[] = [
  { value: "salary", label: "工资" },
  { value: "bonus", label: "奖金 / 提成" },
  { value: "freelance", label: "副业 / 自由职业" },
  { value: "business", label: "经营收入" },
  { value: "family_transfer", label: "家庭支持 / 转入" },
  { value: "savings_draw", label: "存款划入" },
  { value: "other", label: "其他" },
];

function cycleModeLabel(type: CycleType) {
  if (type === "calendar_month") return "按自然月";
  if (type === "salary_based") return "按发薪日";
  return "自定义周期";
}

export function CycleForm({ today, cycle, plan, salaryDay, onSave }: { today: string; cycle?: FinancialCycle; plan?: BudgetPlan; salaryDay?: number; onSave: (cycle: FinancialCycle, plan: BudgetPlan) => void }) {
  const calendar = calendarMonthCycle(today);
  const initialType: CycleType = cycle?.cycleType ?? (cycle ? "salary_based" : salaryDay ? "salary_based" : "calendar_month");
  const [cycleType, setCycleType] = useState<CycleType>(initialType);
  const [day, setDay] = useState(String(cycle?.salaryDay ?? salaryDay ?? "20"));
  const [customStart, setCustomStart] = useState(cycle?.cycleType === "custom" ? cycle.startDate : today);
  const [customEnd, setCustomEnd] = useState(cycle?.cycleType === "custom" ? cycle.endDate : calendar.endDate);
  const [income, setIncome] = useState(String(plan?.availableIncome ?? ""));
  const [investment, setInvestment] = useState(String(plan?.plannedSavings ?? ""));
  const [customInvestment, setCustomInvestment] = useState(!!plan);
  const [fundingSources, setFundingSources] = useState<FundingSource[]>(plan?.fundingSources ?? []);
  const [error, setError] = useState("");

  function buildCycle() {
    if (cycle) return cycle;
    if (cycleType === "calendar_month") return calendarMonthCycle(today);
    if (cycleType === "salary_based") return salaryCycle(today, Number(day));
    return customCycle(customStart, customEnd);
  }

  let preview: FinancialCycle | null = null;
  try { preview = buildCycle(); } catch { /* Incomplete form. */ }

  function applyIncome(value: string, reset = false) {
    setIncome(value);
    try {
      if (!value.trim()) { if (!customInvestment || reset) setInvestment(""); return; }
      const suggestion = suggestBudget(Number(value));
      if (!customInvestment || reset) setInvestment(String(suggestion.investmentTarget));
      if (reset) setCustomInvestment(false);
    } catch { /* Keep the user's inputs while amount is incomplete. */ }
  }

  function addFundingSource() {
    setFundingSources(current => [...current, { id: crypto.randomUUID(), type: cycleType === "salary_based" && current.length === 0 ? "salary" : "other", amount: 0 }]);
  }
  function updateFundingSource(id: string, patch: Partial<FundingSource>) {
    setFundingSources(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  let suggestion: ReturnType<typeof suggestBudget> | null = null;
  let periodSpendable: number | null = null;
  let fundingSourceTotal = 0;
  try {
    if (income !== "") suggestion = suggestBudget(Number(income));
    if (income !== "" && investment !== "") periodSpendable = (cents(Number(income)) - cents(Number(investment))) / 100;
    fundingSourceTotal = fundingSources.reduce((sum, source) => sum + cents(source.amount || 0), 0) / 100;
  } catch { /* Invalid input is explained on submit. */ }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const next = buildCycle();
      const sources = fundingSources.filter(source => source.amount > 0).map(source => ({ ...source, amount: Number(source.amount) }));
      sources.forEach(source => cents(source.amount));
      const budget: BudgetPlan = { cycleId: next.id, availableIncome: Number(income), plannedSavings: Number(investment), necessaryReserve: 0, model: "nature", fundingSources: sources };
      [budget.availableIncome, budget.plannedSavings].forEach(cents);
      if (budget.plannedSavings > budget.availableIncome) throw new Error("投资目标不能超过本周期可用资金");
      setError("");
      onSave(next, budget);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return <form className="cycle-form" onSubmit={submit}>
    <div className="sheet-head cycle-head">
      <span><StoryIcon name="leaf"/></span>
      <div>
        <p className="cycle-kicker">{cycle ? "本周期设置" : "先选一个适合你的节奏"}</p>
        <h2>{cycle ? "这个周期，想怎么安排？" : "你想怎么记录一个财务周期？"}</h2>
        <p>{cycle ? "周期日期保持不变，只调整这个周期的钱。" : "没有固定工资也没关系。自然月最简单，也可以按发薪日或自己定义。"}</p>
      </div>
    </div>

    {!cycle ? <fieldset className="cycle-type-field">
      <legend>财务周期</legend>
      <div className="cycle-type-picker">
        {([
          ["calendar_month", "按自然月", "每月 1 日到月末 · 推荐"],
          ["salary_based", "按发薪日", "适合固定工资"],
          ["custom", "自定义周期", "自己选开始和结束日期"],
        ] as const).map(([value, label, hint]) => <button key={value} type="button" aria-pressed={cycleType === value} className={cycleType === value ? "selected" : ""} onClick={() => setCycleType(value)}>
          <b>{label}</b><small>{hint}</small>
        </button>)}
      </div>
    </fieldset> : <p className="cycle-mode-summary"><span>周期方式</span><b>{cycleModeLabel(initialType)}</b></p>}

    <div className="cycle-core-fields">
      {!cycle && cycleType === "salary_based" && <>
        <label>
          通常几号发工资？
          <input name="salaryDay" type="number" min="1" max="31" step="1" required value={day} onChange={e => setDay(e.target.value)} placeholder="例如 20" />
        </label>
        <details className="micro-disclosure">
          <summary>29–31 日遇到短月怎么办？</summary>
          <p>按当月最后一天作为周期起点，不需要你每个月重新设置。</p>
        </details>
      </>}

      {!cycle && cycleType === "custom" && <div className="custom-cycle-dates">
        <label>开始日期<input name="customStart" type="date" required value={customStart} onChange={e => setCustomStart(e.target.value)} /></label>
        <label>结束日期<input name="customEnd" type="date" required value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></label>
      </div>}

      <label className="income-label">
        本周期可用资金
        <input name="availableIncome" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={income} onChange={e => applyIncome(e.target.value)} placeholder="例如 10000" />
      </label>
      <p className="helper compact-helper">可以是工资，也可以来自副业、存款划入或其他来源。先填总额就能开始。</p>
    </div>

    <section className="funding-source-section">
      <div className="funding-source-head">
        <div><b>资金来源</b><small>可选 · 不拆分也可以</small></div>
        <button type="button" onClick={addFundingSource}>+ 添加来源</button>
      </div>
      {fundingSources.length === 0 ? <p className="helper compact-helper">例如：工资 ¥8,000 + 副业 ¥2,000；待业时也可以记录“存款划入”。</p> : <div className="funding-source-list">
        {fundingSources.map(source => <div className="funding-source-row" key={source.id}>
          <select aria-label="资金来源类型" value={source.type} onChange={e => updateFundingSource(source.id, { type: e.target.value as FundingSourceType })}>
            {FUNDING_SOURCE_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
          <input aria-label="资金来源金额" type="number" inputMode="decimal" min="0" step="0.01" value={source.amount || ""} onChange={e => updateFundingSource(source.id, { amount: Number(e.target.value) })} placeholder="金额" />
          <button type="button" aria-label="删除资金来源" onClick={() => setFundingSources(current => current.filter(item => item.id !== source.id))}>×</button>
        </div>)}
        <div className="funding-source-total"><span>来源合计</span><b>{money(fundingSourceTotal)}</b>{fundingSourceTotal > 0 && fundingSourceTotal !== Number(income || 0) && <button type="button" onClick={() => applyIncome(String(fundingSourceTotal))}>用这个合计</button>}</div>
      </div>}
    </section>

    {suggestion && <section className="allocation-reference" aria-label="小满默认起步方案">
      <div className="allocation-reference-head">
        <div>
          <span>小满建议先这样起步</span>
          <b>先用一个简单结构，后面再按你的习惯调整。</b>
        </div>
        <span className="allocation-reference-badge">可随时改</span>
      </div>
      <div className="allocation-ratios">
        <div data-testid="ratio-consume"><strong>70%</strong><span>消费</span><small>{money(suggestion.consumptionReference)}</small></div>
        <div data-testid="ratio-invest"><strong>25%</strong><span>投资</span><small>{money(suggestion.investmentTarget)}</small></div>
        <div data-testid="ratio-waste"><strong>≤5%</strong><span>浪费</span><small>{money(suggestion.wasteLimit)}</small></div>
      </div>
      <p>它们是方向，不是三个必须花完的钱包。</p>
    </section>}

    <label className="investment-target-field">
      <span>投资目标 <small>{customInvestment ? "已调整" : "默认 25%"}</small></span>
      <input name="plannedSavings" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={investment} onChange={e => { setInvestment(e.target.value); setCustomInvestment(true); }} placeholder="输入可用资金后自动计算" />
    </label>
    <p className="helper compact-helper">可以包含长期储蓄、ETF / 基金、学习和健康等面向未来的投入。</p>
    {income !== "" && customInvestment && <button type="button" className="reset-suggestion" onClick={() => applyIncome(income, true)}>恢复默认 25%</button>}

    <div className={`allocation-preview ${periodSpendable !== null && periodSpendable < 0 ? "over-budget" : ""}`}>
      <StoryIcon name="wallet"/>
      <div>
        <span>扣除投资目标后，这个周期还能安排</span>
        <strong data-testid="budget-preview">{periodSpendable === null ? "等你填好可用资金" : money(periodSpendable)}</strong>
      </div>
    </div>
    {periodSpendable !== null && periodSpendable < 0 && <p className="helper">投资目标已经超过本周期可用资金，先把目标调低一些。</p>}

    <details className="micro-disclosure finance-method-note">
      <summary>为什么是 70% / 25% / ≤5%？</summary>
      <p>70% 是正常生活消费的参考，25% 是面向未来的投资目标，≤5% 是提醒自己少一点后悔型支出的上限。它们不是三个必须花完的钱包。</p>
    </details>

    {preview && <p className="cycle-preview"><span>本周期</span>{preview.startDate} — {preview.endDate}</p>}
    <details className="micro-disclosure data-rule-note">
      <summary>收入与可用资金怎么记录？</summary>
      <p>收入账目用于记录流水；“本周期可用资金”是你明确准备在这个周期安排的钱。新增收入不会自动重复计入，除非你之后明确调整周期计划。</p>
    </details>

    {error && <p role="alert">{error}</p>}
    <button className="primary">{cycle ? "保存这个周期" : "开始这个周期"}</button>
  </form>;
}

export function EntryForm({ today, item, cycles, onSave }: { today: string; item: Transaction | null; cycles: FinancialCycle[]; onSave: (tx: Transaction) => void }) {
  const [type, setType] = useState<"income" | "expense">(item?.type ?? "expense");
  const [amount, setAmount] = useState(item ? String(item.amount) : "");
  const [category, setCategory] = useState(item?.category ?? "餐饮");
  const [nature, setNature] = useState<ExpenseNature | "">(item?.nature ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [date, setDate] = useState(item?.dateNeedsConfirmation ? "" : item ? transactionDay(item) : today);
  const [error, setError] = useState("");
  const [source, setSource] = useState<Transaction["source"]>(item?.source ?? "text");
  const chosenCycle = cycles.find(c => date >= c.startDate && date <= c.endDate);
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const value = Number(amount); cents(value);
      if (value <= 0) throw new Error("金额需大于零");
      if (date > today) throw new Error("请记录已发生的收支，日期不能晚于今天");
      if (!chosenCycle) throw new Error("这一天尚未建立财务周期，请先建立周期或选择已有周期内的日期");
      if (type === "expense" && !nature) throw new Error("请选择消费、浪费或投资");
      const selectedCategory = type === "income" ? "收入" : category;
      onSave({ ...item, id: item?.id ?? crypto.randomUUID(), type, amount: value, category: selectedCategory,
        note: note.trim() || selectedCategory, date,
        icon: CATEGORY_ICONS[selectedCategory as LedgerCategory] ?? selectedCategory.slice(0, 1), source,
        cycleId: chosenCycle.id, nature: type === "expense" ? nature as ExpenseNature : null,
        // Retained only for old-schema compatibility. CR-001 no longer exposes this choice.
        spendKind: type === "expense" ? (item?.spendKind ?? "variable") : null });
      setError("");
    } catch (e) { setError((e as Error).message); }
  }
  const categories = EXPENSE_CATEGORIES.includes(category as LedgerCategory) ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, category];
  const suggested = classifyTransaction(note, type).category;
  return <form onSubmit={submit}><div className="sheet-head"><span><StoryIcon name="book"/></span><div><h2>{item ? "编辑账目" : "今天花了什么？"}</h2><p>记下金额和用途就好，复杂的计算交给小满。</p></div></div>
    <div className="type-tabs"><button type="button" className={type === "expense" ? "selected" : ""} onClick={() => setType("expense")}>支出</button><button type="button" className={type === "income" ? "selected" : ""} onClick={() => setType("income")}>收入</button></div>
    <label>金额<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" max="999999999999.99" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
    {type === "expense" ? <><fieldset className="category-field"><legend>消费分类</legend><div className="category-picker">{categories.map(c => <button type="button" key={c} aria-pressed={category === c} className={category === c ? "selected" : ""} onClick={() => setCategory(c)}><StoryIcon name={categoryIcon[c]??'leaf'}/><span>{c}</span></button>)}</div></fieldset>
    <fieldset className="category-field"><legend>消费性质 · 由你确认</legend><div className="nature-picker">{(["消费", "浪费", "投资"] as const).map(value => <button key={value} type="button" aria-pressed={nature === value} className={nature === value ? "selected" : ""} onClick={() => setNature(value)}>{value}</button>)}</div></fieldset></> : <p className="helper">本笔收入仅作记录。请在周期设置中确认可用收入，避免工资被重复计入。</p>}
    <label>备注（可选）<input name="note" maxLength={100} value={note} onChange={e => { setNote(e.target.value); setSource("text"); }} placeholder="这笔钱用在了哪里" /></label>
    {note && type === "expense" && suggested !== category && <button type="button" className="category-suggestion" onClick={() => setCategory(suggested)}>关键词建议：{suggested} · 点击采用</button>}
    {item?.dateNeedsConfirmation && <p className="error-message">旧账保留了原始时间 {item.date}，请确认记账日期；原财务周期 {cycles.find(c => c.id === item.cycleId)?.startDate} 起。</p>}
    <label>日期<input name="date" type="date" required max={today} value={date} onChange={e => setDate(e.target.value)} /></label>
    <p className="helper">{chosenCycle ? `所属周期 ${chosenCycle.startDate} — ${chosenCycle.endDate}` : "该日期尚无财务周期"}</p>
    {!item && <VoiceNote onText={value => {setNote(value);setSource('voice');}}/>}
    {error && <p className="error-message" role="alert">{error}</p>}<button className="primary">{item ? "保存修改" : "记好了"}</button>
  </form>;
}