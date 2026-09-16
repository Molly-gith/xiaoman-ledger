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
      if (!value.trim()) { if (!customInvestment || reset) setInvestment(''); return; }
      const suggestion = suggestBudget(Number(value));
      if (!customInvestment || reset) setInvestment(String(suggestion.investmentTarget));
      if (reset) setCustomInvestment(false);
    } catch { /* Keep the user's inputs while income is incomplete. */ }
  }
  let suggestion: ReturnType<typeof suggestBudget> | null = null;
  let periodSpendable: number | null = null;
  try {
    if (income !== '') suggestion = suggestBudget(Number(income));
    if (income !== '' && investment !== '') periodSpendable = (cents(Number(income)) - cents(Number(investment))) / 100;
  } catch { /* Invalid input is explained on submit. */ }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const next = cycle ?? salaryCycle(today, Number(day));
      const budget: BudgetPlan = { cycleId: next.id, availableIncome: Number(income), plannedSavings: Number(investment), necessaryReserve: 0, model: "nature" };
      [budget.availableIncome, budget.plannedSavings].forEach(cents);
      if (budget.plannedSavings > budget.availableIncome) throw new Error("投资目标不能超过本周期收入");
      setError(""); onSave(next, budget);
    } catch (e) { setError((e as Error).message); }
  };
  return <form className="cycle-form" onSubmit={submit}><div className="cycle-illustration" role="img" aria-label="小满种子精灵在森林小屋旁等你"/><div className="sheet-head"><span><StoryIcon name="leaf"/></span><div><h2>{cycle ? "给这个周期，重新定个方向" : "先看清这个周期的钱"}</h2><p>不用提前列房租账单，先按一套简单结构开始。</p></div></div>
    <label>每月发薪日<input name="salaryDay" type="number" min="1" max="31" step="1" required value={day} readOnly={!!cycle} onChange={e => setDay(e.target.value)} placeholder="例如 20" /></label>
    <p className="helper">29–31 日遇到短月时，按月末发薪。{cycle ? "本周期日期已确定，下一周期可调整发薪日。" : ""}</p>
    <label className="income-label">这次到手工资<input name="availableIncome" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={income} onChange={e => applyIncome(e.target.value)} placeholder="输入后，小满帮你算出参考结构" /></label>
    <p className="helper">作为本周期可用收入；有其他可安排的钱，也可以加在这里。</p>
    {suggestion && <section className="budget-reference" aria-label="默认财务结构"><h3>小满的起步结构</h3><div className="budget-suggestions">
      <div><span><StoryIcon name="wallet"/>消费参考 <small>约 70%</small></span><b>{money(suggestion.consumptionReference)}</b></div>
      <div><span><StoryIcon name="cup"/>浪费上限 <small>≤ 5%</small></span><b>{money(suggestion.wasteLimit)}</b></div>
      <div><span><StoryIcon name="leaf"/>投资目标 <small>≥ 25%</small></span><b>{money(suggestion.investmentTarget)}</b></div>
    </div><p className="helper">消费是参考、浪费是上限、投资是目标，不是三个必须花完的钱包。</p></section>}
    <label><span>本周期投资目标 <small>{customInvestment ? '已手动调整' : '默认 25%'}</small></span><input name="plannedSavings" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={investment} onChange={e => {setInvestment(e.target.value);setCustomInvestment(true);}} placeholder="输入工资后计算" /></label>
    <p className="helper">可包含储蓄、长期资产、学习和健康等面向未来的投入。</p>
    {income !== '' && <button type="button" className="reset-suggestion" onClick={() => applyIncome(income, true)}>恢复 25% 投资目标</button>}
    <div className={`allocation-preview ${periodSpendable !== null && periodSpendable < 0 ? 'over-budget' : ''}`}><StoryIcon name="wallet"/><div><span>本周期可支出基线</span><strong data-testid="budget-preview">{periodSpendable === null ? '等你填好工资' : money(periodSpendable)}</strong></div></div>
    {periodSpendable !== null && periodSpendable < 0 && <p className="helper">投资目标已超过收入，请先调整。</p>}
    <details className="budget-reference"><summary>70 / 5 / 25 怎么理解？</summary><p>消费约 70% 是正常生活的参考，浪费不超过 5% 是提醒上限，投资至少 25% 是面向未来的目标。房租、水电等实际发生时正常记账，不需要提前做“预留”。</p></details>
    {preview && <p className="cycle-preview">{preview.startDate} — {preview.endDate}</p>}
    <p className="helper">收入账目仅作记录；新增收入后，在这里确认可用收入。账本只保存在这台设备。</p>
    {error && <p role="alert">{error}</p>}<button className="primary">{cycle ? "保存新的周期结构" : "开始这个周期"}</button>
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