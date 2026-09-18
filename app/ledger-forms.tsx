"use client";
import { useState, type FormEvent } from "react";
import type { BudgetPlan, ExpenseNature, FinancialCycle, Transaction } from "../lib/domain/types";
import { cents, salaryCycle, transactionDay } from "../lib/domain/finance";
import { CATEGORY_ICONS, EXPENSE_CATEGORIES, classifyTransaction, type LedgerCategory } from "../lib/classify";
import { suggestBudget } from '../lib/domain/budget-suggestion';
import { money } from './ledger-components';
import { StoryIcon, categoryIcon } from './story-icons';
import { VoiceNote } from './voice-note';

export function CycleForm({ today, cycle, plan, salaryDay, onSave }: { today: string; cycle?: FinancialCycle; plan?: BudgetPlan; salaryDay?: number; onSave: (cycle: FinancialCycle, plan: BudgetPlan) => void }) {
  const [day, setDay] = useState(String(cycle?.salaryDay ?? salaryDay ?? ""));
  const [income, setIncome] = useState(String(plan?.availableIncome ?? ""));
  const [investment, setInvestment] = useState(String(plan?.plannedSavings ?? ""));
  const [customInvestment, setCustomInvestment] = useState(!!plan);
  const [error, setError] = useState("");
  let preview: FinancialCycle | null = null;
  try { preview = cycle ?? salaryCycle(today, Number(day)); } catch { /* Incomplete form. */ }

  function applyIncome(value: string, reset = false) {
    setIncome(value);
    try {
      if (!value.trim()) { if (!customInvestment || reset) setInvestment(""); return; }
      const suggestion = suggestBudget(Number(value));
      if (!customInvestment || reset) setInvestment(String(suggestion.investmentTarget));
      if (reset) setCustomInvestment(false);
    } catch { /* Keep the user's inputs while income is incomplete. */ }
  }

  let suggestion: ReturnType<typeof suggestBudget> | null = null;
  let periodSpendable: number | null = null;
  try {
    if (income !== "") suggestion = suggestBudget(Number(income));
    if (income !== "" && investment !== "") periodSpendable = (cents(Number(income)) - cents(Number(investment))) / 100;
  } catch { /* Invalid input is explained on submit. */ }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const next = cycle ?? salaryCycle(today, Number(day));
      const budget: BudgetPlan = { cycleId: next.id, availableIncome: Number(income), plannedSavings: Number(investment), necessaryReserve: 0, model: "nature" };
      [budget.availableIncome, budget.plannedSavings].forEach(cents);
      if (budget.plannedSavings > budget.availableIncome) throw new Error("投资目标不能超过本周期收入");
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
        <p className="cycle-kicker">{cycle ? "本周期设置" : "先认识一下你的发薪节奏"}</p>
        <h2>{cycle ? "这个周期，想怎么安排？" : "先告诉小满两件事"}</h2>
        <p>{cycle ? "只改真正需要调整的部分。" : "通常几号发工资，以及这次实际到手多少。其他先交给小满。"}</p>
      </div>
    </div>

    <div className="cycle-core-fields">
      <label>
        {cycle ? "本周期发薪日" : "通常几号发工资？"}
        <input name="salaryDay" type="number" min="1" max="31" step="1" required value={day} readOnly={!!cycle} onChange={e => setDay(e.target.value)} placeholder="例如 20" />
      </label>
      <details className="micro-disclosure">
        <summary>{cycle ? "为什么这里不能改？" : "特殊日期怎么处理？"}</summary>
        <p>{cycle ? "当前周期日期已经确定；如果你的发薪日变化，可以在开启下一周期时调整。" : "如果设置 29–31 日，遇到短月时按当月最后一天作为发薪日。"}</p>
      </details>

      <label className="income-label">
        这次实际到手多少？
        <input name="availableIncome" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={income} onChange={e => applyIncome(e.target.value)} placeholder="例如 10000" />
      </label>
      <p className="helper compact-helper">只填这个周期真正可安排的钱；其他临时收入以后可以再补。</p>
    </div>

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
      <input name="plannedSavings" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={investment} onChange={e => { setInvestment(e.target.value); setCustomInvestment(true); }} placeholder="输入工资后自动计算" />
    </label>
    <p className="helper compact-helper">可以包含长期储蓄、ETF / 基金、学习和健康等面向未来的投入。</p>
    {income !== "" && customInvestment && <button type="button" className="reset-suggestion" onClick={() => applyIncome(income, true)}>恢复默认 25%</button>}

    <div className={`allocation-preview ${periodSpendable !== null && periodSpendable < 0 ? "over-budget" : ""}`}>
      <StoryIcon name="wallet"/>
      <div>
        <span>扣除投资目标后，这个周期还能安排</span>
        <strong data-testid="budget-preview">{periodSpendable === null ? "等你填好工资" : money(periodSpendable)}</strong>
      </div>
    </div>
    {periodSpendable !== null && periodSpendable < 0 && <p className="helper">投资目标已经超过本周期收入，先把目标调低一些。</p>}

    <details className="micro-disclosure finance-method-note">
      <summary>为什么是 70% / 25% / ≤5%？</summary>
      <p>70% 是正常生活消费的参考，25% 是面向未来的投资目标，≤5% 是提醒自己少一点后悔型支出的上限。房租、水电发生时直接记账，不需要提前“预留”。</p>
    </details>

    {preview && <p className="cycle-preview"><span>本周期</span>{preview.startDate} — {preview.endDate}</p>}
    <details className="micro-disclosure data-rule-note">
      <summary>收入与数据怎么记录？</summary>
      <p>收入账目用于记录流水；这里的“到手工资”决定本周期可安排金额。数据只保存在当前设备，除非你主动导出或以后开启云同步。</p>
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