"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { LedgerState, Transaction } from "../lib/domain/types";
import { calculateFinance, cents, localDate, sumMoney, transactionDay } from "../lib/domain/finance";
import { buildAssistantContext } from "../lib/domain/assistant-context";
import { askFinancialQuestion } from "../lib/ai/question-client";
import type { FinancialQuestionAnswer } from "../lib/ai/adapter";
import { createLocalRepository } from "../lib/data/local-adapter";
import { defaultState, encodeBackup, normalizeBackup } from "../lib/data/schema";
import { CycleForm, EntryForm } from "./ledger-forms";
import { InvestmentAccounts } from "./investment-accounts";
import { StoryIcon } from './story-icons';
import { ConfirmPanel, DataPanel, EmptyState, GoalForm, LoadingScreen, PageHeader, PeriodTabs, TransactionRow, money, type Period } from "./ledger-components";

type Tab = "home" | "bills" | "review" | "me" | "assets";
type Modal = "add" | "edit" | "delete" | "cycle" | "data" | "import" | "clear" | "goal" | "ai" | null;
const AI_API_URL = import.meta.env.VITE_AI_API_URL?.trim() ?? "";
const FILTERS = [{ key: "all", label: "全部" }, { key: "income", label: "收入" }, { key: "expense", label: "支出" }] as const;
const QUICK_QUESTIONS = ["这周花多了吗？", "帮我复盘这个周期", "我现在最该关注什么？"];

function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function inPeriod(tx: Transaction, period: Period, today: string) {
  const date = transactionDay(tx);
  if (period === "day") return date === today;
  if (period === "month") return date.slice(0, 7) === today.slice(0, 7);
  if (period === "year") return date.slice(0, 4) === today.slice(0, 4);
  return date <= today && +new Date(`${today}T00:00:00Z`) - +new Date(`${date}T00:00:00Z`) < 7 * 86400000;
}

export default function Home() {
  const [repository] = useState(createLocalRepository);
  const [state, setState] = useState<LedgerState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [tab, setTab] = useState<Tab>("home");
  const [assetReturnTab, setAssetReturnTab] = useState<"home" | "bills" | "me">("home");
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [aiToken, setAiToken] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [aiAnswer, setAiAnswer] = useState<{ question: string; value: FinancialQuestionAnswer } | null>(null);
  const aiRequest = useRef<AbortController | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLInputElement>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [modal, setModal] = useState<Modal>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [pendingImport, setPendingImport] = useState<LedgerState | null>(null);
  const [toast, setToast] = useState("");
  const [today, setToday] = useState(() => localDate());
  const showDialog = !!state && modal !== null;

  useEffect(() => () => { aiRequest.current?.abort(); }, []);

  function stopAI(revoke = false) {
    aiRequest.current?.abort();
    aiRequest.current = null;
    setAiBusy(false);
    setAiAnswer(null);
    setAiMessage("");
    if (revoke) setAiToken("");
  }

  // Keep the dock above the on-screen keyboard; reserve its actual height so
  // the last content row can always be scrolled completely above it.
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const shell = dock.closest<HTMLElement>(".app-shell");
    const viewport = window.visualViewport;
    const measure = () => {
      const inset = viewport && viewport.scale === 1
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      dock.style.setProperty("--keyboard-inset", `${inset}px`);
      shell?.style.setProperty("--keyboard-inset", `${inset}px`);
      dock.dataset.keyboard = String(inset > 100);
      shell?.style.setProperty("--dock-height", `${dock.getBoundingClientRect().height}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      shell?.style.removeProperty("--dock-height");
      shell?.style.removeProperty("--keyboard-inset");
    };
  }, [tab, state?.activeCycleId]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [tab]);

  useEffect(() => {
    if (!showDialog) return;
    const sheet = document.querySelector<HTMLElement>(".sheet");
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => [...(sheet?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary') ?? [])].filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving.current) { setModal(null); setError(""); }
      if (event.key !== "Tab") return;
      const elements = controls(), first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); if (previous?.isConnected) previous.focus(); };
  }, [showDialog, modal]);

  useEffect(() => {
    let active = true;
    void repository.ensureCurrentCycle(today).then(value => {
      if (active) setState(current => !current || value.revision >= current.revision ? value : current);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "本机数据读取失败"); });
    const timer = setInterval(() => {
      const date = localDate();
      if (date === today) return;
      // A new date can change the period. Answers must not outlive their snapshot.
      aiRequest.current?.abort();
      aiRequest.current = null;
      setAiBusy(false);
      setAiAnswer(null);
      setAiMessage("");
      setToday(date);
    }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [repository, today]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function commit(action: () => Promise<LedgerState>, message: string): Promise<boolean> {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      const next = await repository.ensureCurrentCycle(today);
      stopAI();
      setState(current => !current || next.revision >= current.revision ? next : current);
      setModal(null);
      setEditing(null);
      setPendingImport(null);
      const c = next.cycles.find(c => c.id === next.activeCycleId);
      const p = next.budgets.find(b => b.cycleId === next.activeCycleId);
      const m = c && p ? calculateFinance(c, p, next.transactions, next.investmentFlows) : null;
      const label = m?.model === "nature" ? "本周期可支出" : "本周期剩余";
      setToast(m && !m.unresolvedCount && m.safeToSpend !== null ? `${message} · ${label} ${money(m.safeToSpend)}` : message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试；输入内容已保留");
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  async function reload() {
    try {
      const next = await repository.ensureCurrentCycle(today);
      stopAI();
      setState(current => !current || next.revision >= current.revision ? next : current);
      setError("");
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    }
  }

  if (!state) {
    return error
      ? <main className="app-shell"><PageHeader title="账本暂时无法读取" subtitle="原有数据已保留" /><p role="alert">{error}</p><button className="primary" onClick={() => void reload()}>重新载入</button></main>
      : <LoadingScreen text="正在打开本地账本" />;
  }

  const cycle = state.cycles.find(c => c.id === state.activeCycleId);
  const plan = state.budgets.find(b => b.cycleId === cycle?.id);
  const metrics = cycle && plan ? calculateFinance(cycle, plan, state.transactions, state.investmentFlows) : null;
  const assistantSnapshot = metrics ? buildAssistantContext({
    asOfDate: today,
    metrics,
    investmentAccounts: state.investmentAccounts,
    investmentFlows: state.investmentFlows,
  }) : null;
  const expired = cycle ? today >= cycle.nextSalaryDate : false;
  const cycleModeText = !cycle ? "尚未建立" : (cycle.cycleType ?? "salary_based") === "calendar_month" ? "按自然月" : (cycle.cycleType ?? "salary_based") === "custom" ? "自定义周期" : `按发薪日 · ${cycle.salaryDay} 日`;
  const visible = state.transactions.filter(tx => inPeriod(tx, period, today) && (filter === "all" || tx.type === filter));
  const cycleTransactions = state.transactions.filter(tx => tx.cycleId === cycle?.id);
  const recent = cycleTransactions.filter(tx => filter === "all" || tx.type === filter).slice(0, 4);
  const total = (items: Transaction[], type: "income" | "expense") => sumMoney(items.filter(tx => tx.type === type).map(tx => tx.amount));
  const openEntry = (tx?: Transaction) => { if (!cycle) { setModal("cycle"); return; } setError(""); setEditing(tx ?? null); setModal(tx ? "edit" : "add"); };
  const openAssets = (from: "home" | "bills" | "me") => { setAssetReturnTab(from); setTab("assets"); };
  const rowActions = { onEdit: openEntry, onDelete: (tx: Transaction) => { setEditing(tx); setModal("delete"); }, removingId: null };
  const changeState = (next: LedgerState, message: string) => void commit(() => repository.replace(next, state.revision), message);
  const exportBackup = () => download(JSON.stringify({ ...encodeBackup(state), exportedAt: new Date().toISOString() }, null, 2), "application/json", `xiaoman-ledger-backup-${today}.json`);
  const exportCsv = () => {
    const escape = (value: string | number) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const rows = [["日期", "类型", "分类", "性质", "事项", "金额", "周期"], ...state.transactions.map(tx => [tx.date, tx.type === "income" ? "收入" : "支出", tx.category, tx.nature ?? "待确认", tx.note, tx.amount.toFixed(2), tx.cycleId ?? "待确认"])];
    download(`\uFEFF${rows.map(row => row.map(escape).join(",")).join("\n")}`, "text/csv;charset=utf-8", `xiaoman-ledger-${today}.csv`);
  };
  const chooseBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error("请选择小于 10 MB 的备份");
      setPendingImport(normalizeBackup(JSON.parse(await file.text())));
      setModal("import");
    } catch (e) {
      setError(e instanceof Error ? e.message : "备份无效");
    }
  };
  const sendAssistantQuestion = async (token = aiToken) => {
    const question = assistantQuestion.trim();
    if (!question || !assistantSnapshot || aiRequest.current) return;
    if (expired) { setAiMessage("这个周期已经结束。请到「我的 → 记账周期」开启新周期，再问我当前的安排。"); return; }
    const controller = new AbortController();
    aiRequest.current = controller;
    setAiBusy(true);
    setAiMessage("");
    setAiAnswer(null);
    const answer = await askFinancialQuestion(AI_API_URL, token, {
      question, snapshot: assistantSnapshot, consent: true,
      context: { today, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    }, { signal: controller.signal });
    if (aiRequest.current !== controller || controller.signal.aborted) return;
    aiRequest.current = null;
    setAiBusy(false);
    if (answer.ok) {
      setAiAnswer({ question, value: answer.result.value });
      setAssistantQuestion("");
    } else {
      setAiMessage(answer.message);
      if (answer.reauthorize) setAiToken("");
    }
  };
  const submitAssistantQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assistantQuestion.trim()) return;
    if (!AI_API_URL) { setToast("AI 分析暂未启用。财务事实与基础功能仍可正常使用。"); return; }
    if (!aiToken) { setModal("ai"); return; }
    void sendAssistantQuestion();
  };

  const filters = <div className="recent-filters" aria-label="筛选账目">{FILTERS.map(item => <button key={item.key} aria-pressed={filter === item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>;
  const natureCard = metrics && <section className="section-block category-card"><div className="section-title"><h2>消费 / 浪费 / 投资</h2><span>按支出金额</span></div>{metrics.natureMix.map(item => <div className="nature-row" key={item.nature}><b>{item.nature}</b><span>{money(item.amount)}</span><small>{item.percent.toFixed(1)}%</small></div>)}{!metrics.totalExpense && <p className="helper">记下第一笔后，这里会展现消费结构。</p>}</section>;
  const consumptionSpend = metrics?.natureMix.find(item => item.nature === "消费")?.amount ?? 0;
  const wasteSpend = metrics?.natureMix.find(item => item.nature === "浪费")?.amount ?? 0;
  const amountOrUnset = (value: number | null) => value === null ? "未设置" : money(value);
  const budgetCard = metrics && plan && <section className="section-block budget-garden">
    <div className="section-title"><h2><StoryIcon name="jar"/>这个周期的钱</h2></div>
    <div className="budget-row cycle-balance"><span>本周期可支出</span><b data-testid="safe-to-spend">{expired ? "周期已结束" : metrics.unresolvedCount ? "待核对旧账" : amountOrUnset(metrics.safeToSpend)}</b></div>
    {expired && <p className="helper">在「我的 → 记账周期」开启新周期，原账目会保留。</p>}
    {!expired && metrics.safeToSpend === null && !metrics.unresolvedCount && <p className="helper">未设置可用资金，照常记录收支。需要计算余额时，可在「我的 → 记账周期」补充。</p>}
    {metrics.model === "nature" ? <>
      <div className="budget-row"><span>消费</span><b>{money(consumptionSpend)}</b></div>
      <div className="budget-row"><span>浪费</span><b>{money(wasteSpend)}</b></div>
      <div className="budget-row"><span>已发生投资</span><b>{money(metrics.investmentSpend)}</b></div>
      <div className="budget-row"><span>投资目标</span><b>{amountOrUnset(metrics.investmentTarget)}</b></div>
    </> : <p className="helper">旧周期保留原来的预算算法，历史金额不变。</p>}
    {!!metrics.unresolvedCount && <p className="helper">{metrics.unresolvedCount} 笔旧支出需要核对日期、周期或消费性质。</p>}
    {!expired && !metrics.unresolvedCount && metrics.safeToSpend !== null && metrics.safeToSpend < 0 && <p className="helper" role="status">本周期已超出当前安排 {money(-metrics.safeToSpend)}。</p>}
  </section>;

  return <main className={`app-shell ${tab === "home" ? "conversation-home" : "detail-page"}`}><fieldset className="app-content" disabled={busy} inert={showDialog}>
    {tab !== "home" && tab !== "assets" && <nav className="page-navigation" aria-label="返回导航"><button className="back-home" onClick={() => setTab("home")}><StoryIcon name="arrow"/>返回小满</button>{tab === "bills" && <button className="detail-add" onClick={() => openEntry()}><StoryIcon name="plus"/>记一笔</button>}</nav>}
    {tab === "home" && <>
      <header className="topbar"><div className="storybook-brand"><StoryIcon name="leaf"/><div><h1>小满</h1><p>把日子，过成喜欢的样子</p></div></div><div className="header-actions"><button className="avatar" onClick={() => setModal("data")} aria-label="本地数据与备份"><StoryIcon name="lock"/></button><button className="avatar" onClick={() => setTab("me")} aria-label="我的设置"><StoryIcon name="user"/></button></div></header>
        {(aiBusy || aiAnswer || aiMessage) && <section className="assistant-answer section-block" aria-live="polite" aria-busy={aiBusy} data-testid="ai-answer">
          {aiBusy && <p role="status">小满正在阅读本次账本摘要…</p>}
          {aiMessage && <p role="alert">{aiMessage}</p>}
          {aiAnswer && <>
            <p className="ai-question">你：{aiAnswer.question}</p>
            <p className="ai-answer-text">{aiAnswer.value.answer}</p>
            {aiAnswer.value.next_actions.length > 0 && <ul>{aiAnswer.value.next_actions.map((action, index) => <li key={index}>{action}</li>)}</ul>}
            <p className="helper">AI 解释 · 依据本次提问时的账本摘要，建议由你决定。每次提问独立回答。</p>
          </>}
        </section>}
      <section className="section-block home-actions-section">
        <div className="section-title"><h2>接下来你可以</h2></div>
        <div className="home-action-grid">
          <button className="home-action-card" data-testid="home-action-add" onClick={() => openEntry()}><StoryIcon name="plus"/><span><b>记一笔</b><small>把刚刚的花费告诉小满</small></span></button>
          <button className="home-action-card" data-testid="home-action-bills" onClick={() => setTab("bills")}><StoryIcon name="book"/><span><b>看看这个月</b><small>消费、浪费和投资</small></span></button>
          <button className="home-action-card" data-testid="home-action-assets" onClick={() => openAssets("home")}><StoryIcon name="jar"/><span><b>我的资产</b><small>投资账户与当前市值</small></span></button>
          <button className="home-action-card" data-testid="home-action-review" onClick={() => setTab("review")}><StoryIcon name="leaf"/><span><b>帮我复盘</b><small>看看这个周期发生了什么</small></span></button>
        </div>
      </section>
      <section className="section-block transactions"><div className="section-title"><h2>最近账目</h2><button onClick={() => setTab("bills")}>查看全部</button></div>{filters}{recent.length ? recent.map(tx => <TransactionRow key={tx.id} item={tx} {...rowActions} />) : <EmptyState compact text="从第一笔开始，让小满慢慢理解你的钱" action={() => openEntry()} />}</section>
      {cycle && <div ref={dockRef} className="assistant-dock" aria-label="与小满对话">
        <div className="assistant-prompts" aria-label="快捷问题">{QUICK_QUESTIONS.map(question => <button key={question} type="button" onClick={() => { setAssistantQuestion(question); questionRef.current?.focus(); }}>{question}</button>)}</div>
        <p id="assistant-availability" className="assistant-provider-note">{!AI_API_URL ? "AI 分析暂未启用 · 记账与财务看板可正常使用" : aiToken ? <>仅在发送时上传摘要 <button type="button" onClick={() => stopAI(true)}>关闭 AI</button></> : "AI 私人体验 · 首次发送前由你确认共享摘要"}</p>
        <form className="assistant-composer" onSubmit={submitAssistantQuestion}>
          <label className="sr-only" htmlFor="assistant-question">问小满</label>
          <input ref={questionRef} id="assistant-question" aria-describedby="assistant-availability" value={assistantQuestion} onChange={event => setAssistantQuestion(event.target.value)} placeholder="问小满：我最近花在哪些地方？" autoComplete="off" enterKeyHint="send" maxLength={500} disabled={aiBusy} />
          <button type="submit" aria-label="发送给小满" disabled={!assistantQuestion.trim() || aiBusy}>{aiBusy ? "回答中" : "发送"}</button>
        </form>
      </div>}
    </>}

    {tab === "bills" && <>
      <PageHeader title="财务" subtitle="消 / 浪 / 投、投资资产与账单都在这里" />
      <div className="home-overview">{budgetCard}{natureCard}</div>
      <section className="section-block category-card">
        <div className="section-title"><h2>投资资产</h2><button onClick={() => openAssets("bills")}>管理投资账户</button></div>
        {assistantSnapshot && assistantSnapshot.investmentAssets.accountCount > 0 ? <>
          <div className="budget-row"><span>当前总市值</span><b>{money(assistantSnapshot.investmentAssets.totalMarketValue)}</b></div>
          <div className="budget-row"><span>累计净投入</span><b>{assistantSnapshot.investmentAssets.totalNetContribution === null ? "成本待补充" : money(assistantSnapshot.investmentAssets.totalNetContribution)}</b></div>
          <div className="budget-row"><span>浮动盈亏</span><b>{assistantSnapshot.investmentAssets.totalFloatingPnL === null ? "暂不计算" : money(assistantSnapshot.investmentAssets.totalFloatingPnL)}</b></div>
        </> : <p className="helper">还没有投资账户。你可以先记录 ETF / 基金的当前市值，历史成本未知时小满不会编造收益。</p>}
      </section>
      <PeriodTabs period={period} setPeriod={setPeriod} />{filters}
      <section className="bill-summary"><div><span>收入记录</span><b>{money(total(visible, "income"))}</b></div><div><span>支出记录</span><b>{money(total(visible, "expense"))}</b></div><div><span>账目</span><b>{visible.length} 笔</b></div></section>
      <section className="transactions bill-list">{visible.length ? visible.map(tx => <TransactionRow key={tx.id} item={tx} {...rowActions} />) : <EmptyState text="这个时段还没有账目" action={() => openEntry()} />}</section>
    </>}

    {tab === "review" && <><PageHeader title="周期复盘" subtitle={cycle ? `${cycle.startDate} 至 ${cycle.endDate}` : "先建立财务周期"} />{metrics && <><section className="stats-hero"><p>本周期实际支出</p><strong>{money(metrics.totalExpense)}</strong><p>{metrics.model === "nature" ? `投资目标 ${amountOrUnset(metrics.investmentTarget)} · 已发生投资 ${money(metrics.investmentSpend)}` : `旧周期计划储蓄 ${amountOrUnset(plan!.plannedSavings)}`}</p><p>收入记录 {money(total(cycleTransactions, "income"))}；本周期可用资金以周期设置为准。</p></section>{budgetCard}{natureCard}<p className="helper">这里展示本周期账本统计。想听小满的解释，可以回到首页提问「帮我复盘这个周期」。</p></>}</>}

    {tab === "me" && <><PageHeader title="我的" subtitle="安排周期，也照顾未来" /><section className="category-card"><h2>周期设置</h2><p>{cycleModeText}{cycle ? ` · ${cycle.startDate} — ${cycle.endDate}` : ""}</p><button className="primary" onClick={() => setModal("cycle")}>记账周期</button><p className="helper">默认按自然月记账，可用资金选填。收入流水不会重复计入可用资金。</p></section><button className="local-data-card" onClick={() => openAssets("me")}><span className="local-data-icon">投</span><span><b>投资账户</b><small>记录已有 ETF / 基金资产与当前市值</small></span></button><section className="goal-card saving"><p>存款目标</p><strong>{money(state.settings.savingsCurrent)} <small>/ {money(state.settings.savingsGoal)}</small></strong><button onClick={() => setModal("goal")}>更新存款目标</button></section><button className="local-data-card" onClick={() => setModal("data")}><span className="local-data-icon">本</span><span><b>本机数据与备份</b><small>换设备前，导出一份完整备份</small></span></button></>}

    {tab === "assets" && <InvestmentAccounts state={state} today={today} onBack={() => setTab(assetReturnTab)} onCreateAccount={account => commit(() => repository.saveInvestmentAccount(account, state.revision), "投资账户已创建")} onFlow={flow => commit(() => repository.saveInvestmentFlow(flow, state.revision), flow.type === "contribution" ? "投资投入已记录" : "投资取出已记录")} onMarketValue={(accountId, value, date) => commit(() => repository.saveMarketValue(accountId, value, date, state.revision), "当前市值已更新")} />}

  </fieldset>

  {modal && <div className="modal-wrap"><section className="sheet" role="dialog" aria-modal="true" aria-label={modal === "add" || modal === "edit" ? "记账" : "账本设置"}>
    {<button className="close" disabled={busy} onClick={() => { setModal(null); setEditing(null); setError(""); }} aria-label="关闭">×</button>}
    <fieldset disabled={busy} className="app-content">
      {modal === "cycle" ? <CycleForm key={cycle?.id ?? "first"} today={today} cycle={!expired ? cycle : undefined} plan={!expired ? plan : undefined} allowCycleChange initialCycleType={cycle?.cycleType ?? (cycle ? "salary_based" : "calendar_month")} salaryDay={state.profile?.salaryDay} onSave={(c, p) => void commit(() => cycle && !expired ? repository.replaceCurrentCycle(c, p, state.revision) : repository.saveCycle(c, p, state.revision), "周期设置已保存")} />
      : modal === "add" || modal === "edit" ? <EntryForm key={editing?.id ?? "new"} today={today} item={editing} cycles={state.cycles} onSave={tx => void commit(() => repository.saveTransaction(tx, state.revision, !!editing), editing ? "账目已修改" : "已记账")} />
      : modal === "delete" && editing ? <ConfirmPanel mark="删" title="确定删除这笔账？" hint="删除后无法恢复" summary={<><span>{editing.note || editing.category}</span><b>{money(editing.amount)}</b></>} cancel="保留账目" confirm="确认删除" onCancel={() => setModal(null)} onConfirm={() => void commit(() => repository.deleteTransaction(editing.id, state.revision), "账目已删除")} />
      : modal === "ai" ? <form className="ai-consent" onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const token = String(fields.get("aiBetaCode") ?? "").trim();
        if (fields.get("aiConsent") !== "on" || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return;
        setAiToken(token);
        setModal(null);
        void sendAssistantQuestion(token);
      }}>
        <h2>让小满理解这次提问</h2>
        <p>发送时，你的问题和本周期财务摘要会交给小满服务、Dify 及模型供应商，用于生成回答。</p>
        <p className="helper">摘要包含金额、消费结构、待核对数量和投资汇总，不包含逐笔账目、备注和账户名称。你写在问题里的内容也会发送；Dify 与模型供应商可能保留调用记录。</p>
        {assistantSnapshot && <details><summary>查看将发送的摘要范围</summary><ul>
          <li>截至 {today}，{assistantSnapshot.unresolvedCount} 笔数据待核对</li>
          <li>本周期可支出：{assistantSnapshot.period.safeToSpend === null ? "未知" : money(assistantSnapshot.period.safeToSpend)}</li>
          <li>消费 {money(assistantSnapshot.period.consumptionSpend)}、浪费 {money(assistantSnapshot.period.wasteSpend)}、投资 {money(assistantSnapshot.period.investmentSpend)}</li>
          <li>投资目标 {amountOrUnset(assistantSnapshot.period.investmentTarget)}，缺口 {amountOrUnset(assistantSnapshot.period.investmentGap)}</li>
          <li>{assistantSnapshot.investmentAssets.accountCount} 个投资账户的市值、净投入和盈亏汇总；未知成本会标记为未知</li>
        </ul></details>}
        <label>私人体验码（必填）<input name="aiBetaCode" type="password" autoComplete="off" minLength={32} maxLength={128} pattern="[A-Za-z0-9_-]{32,128}" required /></label>
        <p className="helper">使用小满提供的体验码，无需填写 Dify 或模型密钥。</p>
        <label className="ai-consent-check"><input name="aiConsent" type="checkbox" required />（必选）我同意在本次会话提问时共享这些内容。刷新页面或关闭 AI 后需要重新确认。</label>
        <button className="primary" type="submit">同意并发送</button>
        <button type="button" onClick={() => setModal(null)}>暂不使用</button>
      </form>
      : modal === "data" ? <DataPanel ledgerKind={state.ledgerKind} count={state.transactions.length} onKind={kind => changeState({ ...state, ledgerKind: kind }, "账本标签已保存")} onBackup={exportBackup} onCsv={exportCsv} onImport={event => void chooseBackup(event)} onClear={() => setModal("clear")} />
      : modal === "import" && pendingImport ? <ConfirmPanel mark="入" title="用备份替换当前账本？" hint={`将恢复 ${pendingImport.transactions.length} 笔账目，当前数据会被覆盖。建议先导出备份。`} cancel="暂不导入" confirm="确认恢复" onCancel={() => setModal("data")} onConfirm={() => changeState(pendingImport, "备份已恢复")} />
      : modal === "goal" ? <GoalForm saved={state.settings.savingsCurrent} goal={state.settings.savingsGoal} onSave={(current, target) => { try { cents(current); cents(target); changeState({ ...state, settings: { ...state.settings, savingsCurrent: current, savingsGoal: target } }, "存款目标已保存"); } catch (e) { setError((e as Error).message); } }} />
      : <ConfirmPanel mark="清" title="清空这台设备的账本？" hint="账目、周期和预算都会删除，无法撤销。建议先导出备份。" cancel="保留数据" confirm="确认清空" onCancel={() => setModal("data")} onConfirm={() => changeState(defaultState(), "账本已清空")} />}
    </fieldset>{busy && <p role="status">正在保存到本机…</p>}{error && <div className="error-message" role="alert">{error}<button disabled={busy} onClick={() => void reload()}>重新载入账本</button></div>}
  </section></div>}
  {error && !modal && <div className="error-message" role="alert">{error}<button onClick={() => void reload()}>重新载入账本</button></div>}
  {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}
