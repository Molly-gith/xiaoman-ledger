"use client";
import { useState, type FormEvent } from "react";
import type { BudgetPlan, ExpenseNature, FinancialCycle, SpendKind, Transaction } from "../lib/domain/types";
import { cents, salaryCycle, transactionDay } from "../lib/domain/finance";
import { CATEGORY_ICONS, EXPENSE_CATEGORIES, classifyTransaction, type LedgerCategory } from "../lib/classify";
import { suggestBudget } from '../lib/domain/budget-suggestion';
import { money } from './ledger-components';
import { StoryIcon, categoryIcon } from './story-icons';
import { VoiceNote } from './voice-note';

export function CycleForm({ today, cycle, plan, salaryDay, onSave }: { today: string; cycle?: FinancialCycle; plan?: BudgetPlan; salaryDay?: number; onSave: (cycle: FinancialCycle, plan: BudgetPlan) => void }) {
  const [day, setDay] = useState(String(cycle?.salaryDay ?? salaryDay ?? ""));
  const [income, setIncome] = useState(String(plan?.availableIncome ?? ""));
  const [savings, setSavings] = useState(String(plan?.plannedSavings ?? ""));
  const [reserve, setReserve] = useState(String(plan?.necessaryReserve ?? ""));
  const [customSavings, setCustomSavings] = useState(!!plan);
  const [customReserve, setCustomReserve] = useState(!!plan);
  const [error, setError] = useState("");
  let preview: FinancialCycle | null = null;
  try { preview = cycle ?? salaryCycle(today, Number(day)); } catch { /* Incomplete form. */ }
  function applyIncome(value: string, reset = false) {
    setIncome(value);
    try {
      if (!value.trim()) { if (!customSavings || reset) setSavings(''); if (!customReserve || reset) setReserve(''); return; }
      const suggestion = suggestBudget(Number(value));
      if (!customSavings || reset) setSavings(String(suggestion.plannedSavings));
      if (!customReserve || reset) setReserve(String(suggestion.necessaryReserve));
      if (reset) { setCustomSavings(false); setCustomReserve(false); }
    } catch { /* Keep the user's inputs while income is incomplete. */ }
  }
  let everyday: number | null = null;
  try { if (income !== '' && savings !== '' && reserve !== '') everyday = (cents(Number(income)) - cents(Number(savings)) - cents(Number(reserve))) / 100; } catch { /* Invalid input is explained on submit. */ }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const next = cycle ?? salaryCycle(today, Number(day));
      const budget = { cycleId: next.id, availableIncome: Number(income), plannedSavings: Number(savings), necessaryReserve: Number(reserve) };
      [budget.availableIncome, budget.plannedSavings, budget.necessaryReserve].forEach(cents);
      setError(""); onSave(next, budget);
    } catch (e) { setError((e as Error).message); }
  };
  return <form className="cycle-form" onSubmit={submit}><div className="cycle-illustration" role="img" aria-label="小满种子精灵在森林小屋旁等你"/><div className="sheet-head"><span><StoryIcon name="leaf"/></span><div><h2>{cycle ? "给这个月，重新安排一下" : "让每一份工资，都有归处"}</h2><p>先存一点，留好账单，剩下的安心花。</p></div></div>
    <label>每月发薪日<input name="salaryDay" type="number" min="1" max="31" step="1" required value={day} readOnly={!!cycle} onChange={e => setDay(e.target.value)} placeholder="例如 20" /></label>
    <p className="helper">29–31 日遇到短月时，按月末发薪。{cycle ? "本周期日期已确定，下一周期可调整发薪日。" : ""}</p>
    <label className="income-label">这次到手工资<input name="availableIncome" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={income} onChange={e => applyIncome(e.target.value)} placeholder="输入后，小满帮你算一份起步计划" /></label>
    <p className="helper">作为本周期可用收入；有其他可安排的钱，也可以加在这里。</p>
    <div className="budget-suggestions"><label><span><StoryIcon name="jar"/>想先存下的钱 <small>{customSavings ? '已手动调整' : '起步建议 15%'}</small></span><input name="plannedSavings" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={savings} onChange={e => {setSavings(e.target.value);setCustomSavings(true);}} placeholder="输入工资后计算" /></label>
    <label><span><StoryIcon name="home"/>给房租和账单留的钱 <small>{customReserve ? '已手动调整' : '起步建议 35%'}</small></span><input name="necessaryReserve" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={reserve} onChange={e => {setReserve(e.target.value);setCustomReserve(true);}} placeholder="输入工资后计算" /></label></div>
    <p className="helper">房租、水电、固定还款等。建议只是起点，请改成实际需要的金额。</p>
    {income !== '' && <button type="button" className="reset-suggestion" onClick={() => applyIncome(income, true)}>重新按 15% / 35% 填入建议</button>}
    <div className={`allocation-preview ${everyday !== null && everyday < 0 ? 'over-budget' : ''}`}><StoryIcon name="wallet"/><div><span>留给日常生活</span><strong data-testid="budget-preview">{everyday === null ? '等你填好工资' : money(everyday)}</strong></div></div>
    {everyday !== null && everyday < 0 && <p className="helper">安排的钱已超过收入，可以先调低储蓄或账单预留。</p>}
    <details className="budget-reference"><summary>这份建议从哪里来？</summary><p>小满起步建议：储蓄 15%、房租账单 35%，其余留给日常。所有金额都可修改。</p><p>横山光昭的参考是消费 70% / 浪费 5% / 投资 25%，投资包括储蓄、学习等。这和房租预留不是一回事，上面的起步比例是小满的产品建议，并非书中原比例。</p><a href="https://media.monex.co.jp/articles/-/18319" target="_blank" rel="noreferrer">查看作者的比例说明</a></details>
    {preview && <p className="cycle-preview">{preview.startDate} — {preview.endDate}</p>}
    <p className="helper">收入账目仅作记录；新增收入后，在这里确认可用收入。账本只保存在这台设备。</p>
    {error && <p role="alert">{error}</p>}<button className="primary">{cycle ? "保存周期预算" : "生成安心可花"}</button>
  </form>;
}

export function EntryForm({ today, item, cycles, onSave }: { today: string; item: Transaction | null; cycles: FinancialCycle[]; onSave: (tx: Transaction) => void }) {
  const [type, setType] = useState<"income" | "expense">(item?.type ?? "expense");
  const [amount, setAmount] = useState(item ? String(item.amount) : "");
  const [category, setCategory] = useState(item?.category ?? "餐饮");
  const [nature, setNature] = useState<ExpenseNature | "">(item?.nature ?? "");
  const [spendKind, setSpendKind] = useState<SpendKind>(item?.spendKind ?? "variable");
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
        cycleId: chosenCycle.id, nature: type === "expense" ? nature as ExpenseNature : null, spendKind: type === "expense" ? spendKind : null });
      setError("");
    } catch (e) { setError((e as Error).message); }
  }
  const categories = EXPENSE_CATEGORIES.includes(category as LedgerCategory) ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, category];
  const suggested = classifyTransaction(note, type).category;
  return <form onSubmit={submit}><div className="sheet-head"><span><StoryIcon name="book"/></span><div><h2>{item ? "编辑账目" : "今天花了什么？"}</h2><p>一笔小记录，让生活更清楚。</p></div></div>
    <div className="type-tabs"><button type="button" className={type === "expense" ? "selected" : ""} onClick={() => setType("expense")}>支出</button><button type="button" className={type === "income" ? "selected" : ""} onClick={() => setType("income")}>收入</button></div>
    <label>金额<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" max="999999999999.99" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
    {type === "expense" ? <><fieldset className="category-field"><legend>消费分类</legend><div className="category-picker">{categories.map(c => <button type="button" key={c} aria-pressed={category === c} className={category === c ? "selected" : ""} onClick={() => setCategory(c)}><StoryIcon name={categoryIcon[c]??'leaf'}/><span>{c}</span></button>)}</div></fieldset>
    <fieldset className="category-field"><legend>消费性质 · 由你确认</legend><div className="nature-picker">{(["消费", "浪费", "投资"] as const).map(value => <button key={value} type="button" aria-pressed={nature === value} className={nature === value ? "selected" : ""} onClick={() => setNature(value)}>{value}</button>)}</div></fieldset>
    <fieldset className="spending-choice"><legend>这笔钱，从哪里出？</legend>
      <label className={spendKind === 'variable' ? 'selected' : ''}><input type="radio" name="spendKind" value="variable" checked={spendKind === 'variable'} onChange={() => setSpendKind('variable')}/><StoryIcon name="cup"/><span><b>日常花销</b><small>吃饭、购物、出行等，从“安心可花”里扣。</small></span></label>
      <label className={spendKind === 'reserved' ? 'selected' : ''}><input type="radio" name="spendKind" value="reserved" checked={spendKind === 'reserved'} onChange={() => setSpendKind('reserved')}/><StoryIcon name="home"/><span><b>房租等已留好的钱</b><small>从之前留出的账单钱里扣，不再减少“安心可花”。</small></span></label>
    </fieldset></> : <p className="helper">本笔收入仅作记录。请在周期预算中确认可用收入，避免工资被重复计入。</p>}
    <label>备注（可选）<input name="note" maxLength={100} value={note} onChange={e => { setNote(e.target.value); setSource("text"); }} placeholder="这笔钱用在了哪里" /></label>
    {note && type === "expense" && suggested !== category && <button type="button" className="category-suggestion" onClick={() => setCategory(suggested)}>关键词建议：{suggested} · 点击采用</button>}
    {item?.dateNeedsConfirmation && <p className="error-message">旧账保留了原始时间 {item.date}，请确认记账日期；原财务周期 {cycles.find(c => c.id === item.cycleId)?.startDate} 起。</p>}
    <label>日期<input name="date" type="date" required max={today} value={date} onChange={e => setDate(e.target.value)} /></label>
    <p className="helper">{chosenCycle ? `所属周期 ${chosenCycle.startDate} — ${chosenCycle.endDate}` : "该日期尚无财务周期"}</p>
    {!item && <VoiceNote onText={value => {setNote(value);setSource('voice');}}/>}
    {error && <p className="error-message" role="alert">{error}</p>}<button className="primary">{item ? "保存修改" : "记好了"}</button>
  </form>;
}
