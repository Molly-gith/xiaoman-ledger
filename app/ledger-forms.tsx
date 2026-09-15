"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BudgetPlan, ExpenseNature, FinancialCycle, SpendKind, Transaction } from "../lib/domain/types";
import { cents, salaryCycle, transactionDay } from "../lib/domain/finance";
import { CATEGORY_ICONS, EXPENSE_CATEGORIES, classifyTransaction, type LedgerCategory } from "../lib/classify";

export function CycleForm({ today, cycle, plan, salaryDay, onSave }: { today: string; cycle?: FinancialCycle; plan?: BudgetPlan; salaryDay?: number; onSave: (cycle: FinancialCycle, plan: BudgetPlan) => void }) {
  const [day, setDay] = useState(String(cycle?.salaryDay ?? salaryDay ?? ""));
  const [income, setIncome] = useState(String(plan?.availableIncome ?? ""));
  const [savings, setSavings] = useState(String(plan?.plannedSavings ?? 0));
  const [reserve, setReserve] = useState(String(plan?.necessaryReserve ?? 0));
  const [error, setError] = useState("");
  let preview: FinancialCycle | null = null;
  try { preview = cycle ?? salaryCycle(today, Number(day)); } catch { /* Incomplete form. */ }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const next = cycle ?? salaryCycle(today, Number(day));
      const budget = { cycleId: next.id, availableIncome: Number(income), plannedSavings: Number(savings), necessaryReserve: Number(reserve) };
      [budget.availableIncome, budget.plannedSavings, budget.necessaryReserve].forEach(cents);
      setError(""); onSave(next, budget);
    } catch (e) { setError((e as Error).message); }
  };
  return <form onSubmit={submit}><div className="sheet-head"><span>满</span><div><p>先安排这个周期的钱</p><h2>{cycle ? "调整本周期预算" : "建立你的财务周期"}</h2></div></div>
    <label>每月发薪日<input name="salaryDay" type="number" min="1" max="31" step="1" required value={day} readOnly={!!cycle} onChange={e => setDay(e.target.value)} placeholder="例如 20" /></label>
    <p className="helper">29–31 日遇到短月时，按月末发薪。{cycle ? "本周期日期已确定，下一周期可调整发薪日。" : ""}</p>
    <label>本周期可用收入<input name="availableIncome" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={income} onChange={e => setIncome(e.target.value)} placeholder="确认这个周期可安排的钱" /></label>
    <label>计划储蓄<input name="plannedSavings" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={savings} onChange={e => setSavings(e.target.value)} /></label>
    <label>必要支出预留<input name="necessaryReserve" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" required value={reserve} onChange={e => setReserve(e.target.value)} /></label>
    <p className="helper">例如房租、固定账单。记这类支出时选择“使用必要预留”，避免重复扣减。</p>
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
  const [date, setDate] = useState(item ? transactionDay(item) : today);
  const [error, setError] = useState("");
  const [source, setSource] = useState<Transaction["source"]>(item?.source ?? "text");
  const [listening, setListening] = useState(false);
  const voice = useRef<{ abort: () => void } | null>(null);
  useEffect(() => () => voice.current?.abort(), []);
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
        note: note.trim() || selectedCategory, date: item && transactionDay(item) === date ? item.date : date,
        icon: CATEGORY_ICONS[selectedCategory as LedgerCategory] ?? selectedCategory.slice(0, 1), source,
        cycleId: chosenCycle.id, nature: type === "expense" ? nature as ExpenseNature : null, spendKind: type === "expense" ? spendKind : null });
      setError("");
    } catch (e) { setError((e as Error).message); }
  }
  function startVoice() {
    type Recognition = { lang: string; interimResults: boolean; start: () => void; abort: () => void; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void };
    const win = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Constructor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Constructor) { setError("当前浏览器不支持语音，可以直接手动记账"); return; }
    const recognition = new Constructor(); voice.current = recognition; recognition.lang = "zh-CN"; recognition.interimResults = false;
    recognition.onresult = event => { setNote(event.results[0][0].transcript.slice(0, 100)); setSource("voice"); setError("语音已转成备注，请确认金额、分类和消费性质后保存"); };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => { setListening(false); setError("语音暂不可用，请继续手动输入"); };
    try { setListening(true); recognition.start(); } catch { setListening(false); setError("无法启动语音，请手动输入"); }
  }
  const categories = EXPENSE_CATEGORIES.includes(category as LedgerCategory) ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, category];
  const suggested = classifyTransaction(note, type).category;
  return <form onSubmit={submit}><div className="sheet-head"><span>记</span><div><p>手动记账，随时可用</p><h2>{item ? "编辑账目" : "今天花了什么？"}</h2></div></div>
    <div className="type-tabs"><button type="button" className={type === "expense" ? "selected" : ""} onClick={() => setType("expense")}>支出</button><button type="button" className={type === "income" ? "selected" : ""} onClick={() => setType("income")}>收入</button></div>
    <label>金额<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" max="999999999999.99" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
    {type === "expense" ? <><fieldset className="category-field"><legend>消费分类</legend><div className="category-picker">{categories.map(c => <button type="button" key={c} aria-pressed={category === c} className={category === c ? "selected" : ""} onClick={() => setCategory(c)}>{CATEGORY_ICONS[c as LedgerCategory] ?? "其"}<span>{c}</span></button>)}</div></fieldset>
    <fieldset className="category-field"><legend>消费性质 · 由你确认</legend><div className="nature-picker">{(["消费", "浪费", "投资"] as const).map(value => <button key={value} type="button" aria-pressed={nature === value} className={nature === value ? "selected" : ""} onClick={() => setNature(value)}>{value}</button>)}</div></fieldset>
    <label>支出来源<select name="spendKind" value={spendKind} onChange={e => setSpendKind(e.target.value as SpendKind)}><option value="variable">可变支出 · 扣减安心可花</option><option value="reserved">使用必要预留 · 不重复扣减</option></select></label></> : <p className="helper">本笔收入仅作记录。请在周期预算中确认可用收入，避免工资被重复计入。</p>}
    <label>备注（可选）<input name="note" maxLength={100} value={note} onChange={e => { setNote(e.target.value); setSource("text"); }} placeholder="这笔钱用在了哪里" /></label>
    {note && type === "expense" && suggested !== category && <button type="button" className="category-suggestion" onClick={() => setCategory(suggested)}>关键词建议：{suggested} · 点击采用</button>}
    <label>日期<input name="date" type="date" required max={today} value={date} onChange={e => setDate(e.target.value)} /></label>
    <p className="helper">{chosenCycle ? `所属周期 ${chosenCycle.startDate} — ${chosenCycle.endDate}` : "该日期尚无财务周期"}</p>
    {!item && <button className="voice-button" type="button" disabled={listening} onClick={startVoice}>{listening ? "正在听…" : "用语音填写备注"}</button>}
    {error && <p className="error-message" role="alert">{error}</p>}<button className="primary">{item ? "保存修改" : "记好了"}</button>
  </form>;
}
