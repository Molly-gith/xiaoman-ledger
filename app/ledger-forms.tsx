"use client";
import { useState, type FormEvent } from "react";
import type { BudgetPlan, CycleType, ExpenseNature, FinancialCycle, FundingSource, FundingSourceType, Transaction } from "../lib/domain/types";
import { calendarMonthCycle, cents, customCycle, parseDate, salaryCycle, transactionDay } from "../lib/domain/finance";
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

export function CycleForm({ today, cycle, plan, salaryDay, initialCycleType, allowCycleChange = false, onSave }: { today: string; cycle?: FinancialCycle; plan?: BudgetPlan; salaryDay?: number; initialCycleType?: CycleType; allowCycleChange?: boolean; onSave: (cycle: FinancialCycle, plan: BudgetPlan) => void }) {
  const calendar = calendarMonthCycle(today);
  const initialType: CycleType = cycle ? cycle.cycleType ?? "salary_based" : initialCycleType ?? "calendar_month";
  const canChooseCycle = !cycle || allowCycleChange;
  const [cycleType, setCycleType] = useState<CycleType>(initialType);
  const [day, setDay] = useState(String(cycle?.salaryDay ?? salaryDay ?? "20"));
  const [customStart, setCustomStart] = useState(cycle?.cycleType === "custom" ? cycle.startDate : today);
  const [customEnd, setCustomEnd] = useState(cycle?.cycleType === "custom" ? cycle.endDate : calendar.endDate);
  const [income, setIncome] = useState(String(plan?.availableIncome ?? ""));
  const [investment, setInvestment] = useState(String(plan?.plannedSavings ?? ""));
  const [fundingSources, setFundingSources] = useState<(Omit<FundingSource, "amount"> & { amount: string })[]>(
    () => (plan?.fundingSources ?? []).map(source => ({ ...source, amount: String(source.amount) })),
  );
  const [error, setError] = useState("");

  function buildCycle() {
    if (!canChooseCycle && cycle) return cycle;
    if (cycle && cycleType === initialType && (
      cycleType === "calendar_month"
      || (cycleType === "salary_based" && Number(day) === cycle.salaryDay)
      || (cycleType === "custom" && customStart === cycle.startDate && customEnd === cycle.endDate)
    )) return cycle;
    if (cycleType === "calendar_month") return calendarMonthCycle(today);
    if (cycleType === "salary_based") return salaryCycle(today, Number(day));
    return customCycle(customStart, customEnd);
  }

  let preview: FinancialCycle | null = null;
  try { preview = buildCycle(); } catch { /* Incomplete form. */ }

  function addFundingSource() {
    setFundingSources(current => [...current, { id: crypto.randomUUID(), type: cycleType === "salary_based" && current.length === 0 ? "salary" : "other", amount: "" }]);
  }
  function updateFundingSource(id: string, patch: { type?: FundingSourceType; amount?: string }) {
    setFundingSources(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  let suggestion: ReturnType<typeof suggestBudget> | null = null;
  let periodSpendable: number | null = null;
  let fundingSourceTotal = 0;
  try {
    if (income.trim()) {
      suggestion = suggestBudget(Number(income));
      periodSpendable = (cents(Number(income)) - (investment.trim() ? cents(Number(investment)) : 0)) / 100;
    }
    fundingSourceTotal = fundingSources.reduce((sum, source) => sum + (source.amount.trim() ? cents(Number(source.amount)) : 0), 0) / 100;
  } catch { /* Invalid input is explained on submit. */ }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const next = buildCycle();
      const sources = fundingSources.filter(source => source.amount.trim()).map(source => ({ ...source, amount: Number(source.amount) }));
      sources.forEach(source => cents(source.amount));
      if (sources.some(source => source.amount <= 0)) throw new Error("资金来源金额需大于 0；暂不填写时请留空。");
      const budget: BudgetPlan = { cycleId: next.id, availableIncome: income.trim() ? Number(income) : null, plannedSavings: investment.trim() ? Number(investment) : null, necessaryReserve: 0, model: "nature", fundingSources: sources };
      for (const amount of [budget.availableIncome, budget.plannedSavings]) if (amount !== null) cents(amount);
      if (budget.plannedSavings !== null && budget.availableIncome !== null && budget.plannedSavings > budget.availableIncome) throw new Error("投资目标不能超过本周期可用资金");
      setError("");
      onSave(next, budget);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return <form className="cycle-form" onSubmit={submit} onInvalid={event => {
    const disclosure = (event.target as HTMLElement).closest("details");
    if (disclosure) disclosure.open = true;
  }}>
    <div className="sheet-head cycle-head">
      <span><StoryIcon name="leaf"/></span>
      <div>
        <h2>记账周期</h2>
        <p>{cycle && canChooseCycle ? "更换周期会保留记录。新日期必须包含本周期已有记录，否则无法保存。" : canChooseCycle ? "选好记账的节奏，资金可以以后再填。" : "周期日期保持不变，只调整资金与目标。"}</p>
      </div>
    </div>

    {canChooseCycle ? <fieldset className="cycle-type-field">
      <legend>周期方式（已选{cycleModeLabel(cycleType)}，可修改）</legend>
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
      {canChooseCycle && cycleType === "salary_based" && <>
        <label>
          发薪日（必填）
          <input name="salaryDay" type="number" min="1" max="31" step="1" required value={day} onChange={e => setDay(e.target.value)} placeholder="例如 20" />
        </label>
        <details className="micro-disclosure">
          <summary>29–31 日遇到短月怎么办？</summary>
          <p>按当月最后一天作为周期起点，不需要你每个月重新设置。</p>
        </details>
      </>}

      {canChooseCycle && cycleType === "custom" && <div className="custom-cycle-dates">
        <label>开始日期（必填）<input name="customStart" type="date" required value={customStart} onChange={e => setCustomStart(e.target.value)} /></label>
        <label>结束日期（必填）<input name="customEnd" type="date" required min={customStart} value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></label>
      </div>}

      <label className="income-label">
        本周期可用资金（选填）
        <input name="availableIncome" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" value={income} onChange={e => setIncome(e.target.value)} placeholder="例如 10000，也可以先留空" aria-describedby="cycle-funds-hint" />
      </label>
      <p className="helper compact-helper" id="cycle-funds-hint">准备在这个周期安排的总额。留空也能记账，填写后才计算剩余可支出。</p>
    </div>

    <details className="form-disclosure funding-source-section">
      <summary>资金来源（选填）{fundingSources.length > 0 && <small> · {fundingSources.length} 项</small>}</summary>
      <div className="funding-source-head">
        <small>只作说明，不会重复加到可用资金。</small>
        <button type="button" onClick={addFundingSource}>+ 添加来源</button>
      </div>
      {fundingSources.length > 0 && <div className="funding-source-list">
        {fundingSources.map((source, index) => <div className="funding-source-row" key={source.id}>
          <label>来源类型（必选）<select aria-label={`资金来源 ${index + 1} 类型（必选）`} value={source.type} onChange={e => updateFundingSource(source.id, { type: e.target.value as FundingSourceType })}>
            {FUNDING_SOURCE_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select></label>
          <label>金额（选填）<input aria-label={`资金来源 ${index + 1} 金额（选填）`} type="number" inputMode="decimal" min="0.01" max="999999999999.99" step="0.01" value={source.amount} onChange={e => updateFundingSource(source.id, { amount: e.target.value })} placeholder="留空不保存" /></label>
          <button type="button" aria-label={`删除资金来源 ${index + 1}`} onClick={() => setFundingSources(current => current.filter(item => item.id !== source.id))}>×</button>
        </div>)}
        <div className="funding-source-total"><span>来源合计</span><b>{money(fundingSourceTotal)}</b>{fundingSourceTotal > 0 && fundingSourceTotal !== Number(income || 0) && <button type="button" onClick={() => setIncome(String(fundingSourceTotal))}>用这个合计</button>}</div>
      </div>}
    </details>

    <details className="form-disclosure investment-target-disclosure">
      <summary>投资目标（选填）{investment.trim() && Number.isFinite(Number(investment)) && <small> · {money(Number(investment))}</small>}</summary>
      <label className="investment-target-field">
        投资目标（选填）
        <input name="plannedSavings" type="number" inputMode="decimal" min="0" step="0.01" max="999999999999.99" value={investment} onChange={e => setInvestment(e.target.value)} placeholder="想留给未来的金额，可以先留空" aria-describedby="cycle-investment-hint" />
      </label>
      <p className="helper compact-helper" id="cycle-investment-hint">未设置投资目标时，不额外预留；仍可正常记账。</p>
      {suggestion && <button type="button" className="reset-suggestion" onClick={() => setInvestment(String(suggestion.investmentTarget))}>采用 25% 参考 · {money(suggestion.investmentTarget)}</button>}
      <p className="helper compact-helper">投资可以包括长期储蓄、ETF / 基金、学习和健康等面向未来的投入。</p>
    </details>

    {periodSpendable !== null && <div className={`allocation-preview ${periodSpendable < 0 ? "over-budget" : ""}`}>
      <StoryIcon name="wallet"/>
      <div>
        <span>周期开始时可安排 · 未扣除已记支出</span>
        <strong data-testid="budget-preview">{money(periodSpendable)}</strong>
      </div>
    </div>}
    {periodSpendable !== null && periodSpendable < 0 && <p className="helper">投资目标已经超过本周期可用资金，先把目标调低一些。</p>}

    {preview && <p className="cycle-preview"><span>本周期</span>{preview.startDate} — {preview.endDate}</p>}
    <details className="micro-disclosure data-rule-note">
      <summary>收入与可用资金怎么记录？</summary>
      <p>收入账目用于记录流水；“本周期可用资金”是你明确准备在这个周期安排的钱。新增收入不会自动重复计入，除非你之后明确调整周期计划。</p>
    </details>

    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="primary">保存周期设置</button>
  </form>;
}

export function EntryForm({ today, item, cycles, onSave }: { today: string; item: Transaction | null; cycles: FinancialCycle[]; onSave: (tx: Transaction) => void }) {
  const [type, setType] = useState<"income" | "expense">(item?.type ?? "expense");
  const [amount, setAmount] = useState(item ? String(item.amount) : "");
  const [category, setCategory] = useState(item?.type === "expense" ? item.category : "");
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
      parseDate(date);
      if (date > today) throw new Error("请记录已发生的收支，日期不能晚于今天");
      if (!chosenCycle) throw new Error("这一天尚未建立周期，请到「我的 → 记账周期」设置，或选择已有周期内的日期");
      if (type === "expense" && !category) throw new Error("请选择这笔支出的分类");
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
  const categories = !category || EXPENSE_CATEGORIES.includes(category as LedgerCategory) ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, category];
  const suggested = classifyTransaction(note, type).category;
  return <form onSubmit={submit}><div className="sheet-head"><span><StoryIcon name="book"/></span><div><h2>{item ? "编辑账目" : "记下这一笔"}</h2><p>{type === "expense" ? "填金额，选好分类和性质；备注可以不填。" : item ? "确认金额和日期；备注可以不填。" : "填金额就可以，日期已默认今天。"}</p></div></div>
    <div className="type-tabs" role="group" aria-label={item ? "收支类型（可修改）" : "收支类型（默认支出，可修改）"}><button type="button" aria-pressed={type === "expense"} className={type === "expense" ? "selected" : ""} onClick={() => setType("expense")}>支出</button><button type="button" aria-pressed={type === "income"} className={type === "income" ? "selected" : ""} onClick={() => setType("income")}>收入</button></div>
    <label>金额（必填）<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" max="999999999999.99" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
    {type === "expense" ? <><fieldset className="category-field"><legend>支出分类（必选）</legend><div className="category-picker">{categories.map(c => <button type="button" key={c} aria-pressed={category === c} className={category === c ? "selected" : ""} onClick={() => setCategory(c)}><StoryIcon name={categoryIcon[c]??'leaf'}/><span>{c}</span></button>)}</div></fieldset>
    <fieldset className="category-field"><legend>支出性质（必选，由你确认）</legend><div className="nature-picker">{(["消费", "浪费", "投资"] as const).map(value => <button key={value} type="button" aria-pressed={nature === value} className={nature === value ? "selected" : ""} onClick={() => setNature(value)}>{value}</button>)}</div></fieldset></> : <p className="helper">收入账目只记录流水，不会自动增加本周期可用资金。</p>}
    <label>备注（选填）<input name="note" maxLength={100} value={note} onChange={e => { setNote(e.target.value); setSource("text"); }} placeholder="这笔钱用在了哪里" /></label>
    {note && type === "expense" && suggested !== category && <button type="button" className="category-suggestion" onClick={() => setCategory(suggested)}>关键词建议：{suggested} · 点击采用</button>}
    {item?.dateNeedsConfirmation && <p className="error-message">旧账保留了原始时间 {item.date}，请确认记账日期；原财务周期 {cycles.find(c => c.id === item.cycleId)?.startDate} 起。</p>}
    <label>{item?.dateNeedsConfirmation ? "日期（必填，请确认旧账日期）" : item ? "日期（必填，可修改）" : "日期（默认今天，可修改）"}<input name="date" type="date" required max={today} value={date} onChange={e => setDate(e.target.value)} /></label>
    <p className="helper">{chosenCycle ? `所属周期 ${chosenCycle.startDate} — ${chosenCycle.endDate}` : "该日期尚无财务周期"}</p>
    {!item && <VoiceNote onText={value => {setNote(value);setSource('voice');}}/>}
    {error && <p className="error-message" role="alert">{error}</p>}<button className="primary">{item ? "保存修改" : "记好了"}</button>
  </form>;
}
