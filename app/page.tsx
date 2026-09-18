"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { LedgerState, Transaction } from "../lib/domain/types";
import { calculateFinance, cents, localDate, sumMoney, transactionDay } from "../lib/domain/finance";
import { buildAssistantContext } from "../lib/domain/assistant-context";
import { createLocalRepository } from "../lib/data/local-adapter";
import { defaultState, normalizeBackup } from "../lib/data/schema";
import { CycleForm, EntryForm } from "./ledger-forms";
import { InvestmentAccounts } from "./investment-accounts";
import { StoryIcon } from './story-icons';
import { ConfirmPanel, DataPanel, EmptyState, GoalForm, LoadingScreen, PageHeader, PeriodTabs, TransactionRow, money, type Period } from "./ledger-components";

type Tab = "home" | "bills" | "review" | "me" | "assets";
type Modal = "add" | "edit" | "delete" | "cycle" | "data" | "import" | "clear" | "goal" | null;
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
  const dockRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLInputElement>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [modal, setModal] = useState<Modal>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [pendingImport, setPendingImport] = useState<LedgerState | null>(null);
  const [toast, setToast] = useState("");
  const [today, setToday] = useState(() => localDate());
  const showDialog = !!state && (!state.activeCycleId || modal !== null);
  const canDismiss = !!state?.activeCycleId;

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
    const controls = () => [...(sheet?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])];
    controls()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canDismiss && !saving.current) { setModal(null); setError(""); }
      if (event.key !== "Tab") return;
      const elements = controls(), first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); if (previous?.isConnected) previous.focus(); };
  }, [showDialog, canDismiss, modal]);

  useEffect(() => {
    let active = true;
    void repository.read().then(value => { if (active) setState(value); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "本机数据读取失败"); });
    const timer = setInterval(() => setToday(localDate()), 30000);
    return () => { active = false; clearInterval(timer); };
  }, [repository]);

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
      const next = await action();
      setState(next);
      setModal(null);
      setEditing(null);
      setPendingImport(null);
      const c = next.cycles.find(c => c.id === next.activeCycleId);
      const p = next.budgets.find(b => b.cycleId === next.activeCycleId);
      const m = c && p ? calculateFinance(c, p, next.transactions, next.investmentFlows) : null;
      const label = m?.model === "nature" ? "本周期可支出" : "本周期剩余";
      setToast(m && !m.unresolvedCount ? `${message} · ${label} ${money(m.safeToSpend)}` : message);
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
      const next = await repository.read();
      setState(next);
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
  const setup = !cycle;
  const visible = state.transactions.filter(tx => inPeriod(tx, period, today) && (filter === "all" || tx.type === filter));
  const cycleTransactions = state.transactions.filter(tx => tx.cycleId === cycle?.id);
  const recent = cycleTransactions.filter(tx => filter === "all" || tx.type === filter).slice(0, 4);
  const total = (items: Transaction[], type: "income" | "expense") => sumMoney(items.filter(tx => tx.type === type).map(tx => tx.amount));
  const openEntry = (tx?: Transaction) => { if (!cycle) { setModal("cycle"); return; } setError(""); setEditing(tx ?? null); setModal(tx ? "edit" : "add"); };
  const openAssets = (from: "home" | "bills" | "me") => { setAssetReturnTab(from); setTab("assets"); };
  const rowActions = { onEdit: openEntry, onDelete: (tx: Transaction) => { setEditing(tx); setModal("delete"); }, removingId: null };
  const changeState = (next: LedgerState, message: string) => void commit(() => repository.replace(next, state.revision), message);
  const exportBackup = () => download(JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), "application/json", `xiaoman-ledger-backup-${today}.json`);
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
  const submitAssistantQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assistantQuestion.trim()) return;
    setToast("AI 分析暂未启用。财务事实与基础功能仍可正常使用。");
  };

  const filters = <div className="recent-filters" aria-label="筛选账目">{FILTERS.map(item => <button key={item.key} aria-pressed={filter === item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>;
  const natureCard = metrics && <section className="section-block category-card"><div className="section-title"><h2>消费 / 浪费 / 投资</h2><span>按支出金额</span></div>{metrics.natureMix.map(item => <div className="nature-row" key={item.nature}><b>{item.nature}</b><span>{money(item.amount)}</span><small>{item.percent.toFixed(1)}%</small></div>)}{!metrics.totalExpense && <p className="helper">记下第一笔后，这里会展现消费结构。</p>}</section>;
  const consumptionSpend = metrics?.natureMix.find(item => item.nature === "消费")?.amount ?? 0;
  const wasteSpend = metrics?.natureMix.find(item => item.nature === "浪费")?.amount ?? 0;
  const budgetCard = metrics && plan && <section className="section-block budget-garden"><div className="section-title"><h2><StoryIcon name="jar"/>这个周期的钱</h2><button onClick={() => setModal("cycle")}>调整结构</button></div>{metrics.model === "nature" ? <>
    <div className="budget-row"><span>消费参考 · 约 70%</span><b>{money(consumptionSpend)} / {money(metrics.consumptionReference)}</b></div>
    <div className="budget-row"><span>浪费上限 · ≤ 5%</span><b>{money(wasteSpend)} / {money(metrics.wasteLimit)}</b></div>
    <div className="budget-row"><span>投资目标 · ≥ 25%</span><b>{money(metrics.investmentSpend)} / {money(metrics.investmentTarget)}</b></div>
    <div className="savings-line"><StoryIcon name="leaf"/><span>目标是结构更健康，不是把每个额度花完。<small>房租、水电等发生时直接正常记账。</small></span></div>
  </> : <><div className="budget-row"><span>当前周期剩余</span><b>{money(metrics.safeToSpend)}</b></div><div className="gentle-tip"><p>这是升级前建立的旧周期，继续沿用原计算，避免历史金额突然变化。调整周期后即可切换到新的 70 / 5 / 25 结构。</p></div></>}</section>;

  const safeToSpendText = assistantSnapshot?.readiness === "needs_review"
    ? "待核对旧账"
    : expired
      ? "请开启新周期"
      : assistantSnapshot?.period.safeToSpend === null || !assistantSnapshot
        ? "数据不足"
        : money(assistantSnapshot.period.safeToSpend);

  const assistantHeadline = !assistantSnapshot
    ? "先补一点财务信息，我再帮你判断。"
    : assistantSnapshot.readiness === "needs_review"
      ? "先把几笔旧账核对清楚，我再给你更确定的判断。"
      : expired
        ? "这个周期已经结束。先确认收入，再看下一步怎么安排。"
        : assistantSnapshot.period.safeToSpend === null
          ? "数据还不够完整。先补一点信息，我再帮你判断。"
          : metrics && metrics.safeToSpend < 0
            ? "这个周期已经超出当前结构目标，先看最需要调整的地方。"
            : "这个周期整体还稳。";

  const assistantNextStep = !assistantSnapshot
    ? "先建立财务周期。"
    : assistantSnapshot.period.investmentGap > 0
      ? `接下来最值得关注：投资目标还差 ${money(assistantSnapshot.period.investmentGap)}。`
      : assistantSnapshot.investmentAssets.accountCount > 0
        ? "投资目标已经达到，可以继续按现在的节奏。"
        : "下一步可以先补充资产，或者直接问我你最关心的问题。";

  return <main className={`app-shell ${tab === "home" ? "conversation-home" : "detail-page"}`}><fieldset className="app-content" disabled={busy} inert={showDialog}>
    {tab !== "home" && tab !== "assets" && <nav className="page-navigation" aria-label="返回导航"><button className="back-home" onClick={() => setTab("home")}><StoryIcon name="arrow"/>返回小满</button>{tab === "bills" && <button className="detail-add" onClick={() => openEntry()}><StoryIcon name="plus"/>记一笔</button>}</nav>}
    {tab === "home" && <>
      <header className="topbar"><div className="storybook-brand"><StoryIcon name="leaf"/><div><h1>小满</h1><p>你的个人财务助手</p></div></div><div className="header-actions"><button className="avatar" onClick={() => setModal("data")} aria-label="本地数据与备份"><StoryIcon name="lock"/></button><button className="avatar" onClick={() => setTab("me")} aria-label="我的设置"><StoryIcon name="user"/></button></div></header>
      {cycle && metrics && assistantSnapshot && <>
        <section className="assistant-conversation" data-testid="assistant-conversation">
          <div className="assistant-thread-head"><span className="assistant-avatar" aria-hidden="true"><StoryIcon name="leaf"/></span><div><b>小满</b><small data-testid="assistant-readiness">{assistantSnapshot.readiness === "ready" ? "数据已就绪" : "有数据待核对"}</small></div></div>
          <div className="assistant-message">
            <p className="assistant-summary">{assistantHeadline}</p>
            <p className="assistant-key-fact"><span>这个周期还能安排</span><strong data-testid="safe-to-spend">{safeToSpendText}</strong></p>
            <p className="assistant-next-step">{assistantNextStep}</p>
          </div>
          <p className="assistant-fact-note"><StoryIcon name="lock"/>根据本机账本计算 · 数据由你掌控</p>
        </section>
        {expired && <button className="primary" onClick={() => setModal("cycle")}>确认收入，开启新周期</button>}
        {!!metrics.unresolvedCount && <div className="gentle-tip"><p>{metrics.unresolvedCount} 笔旧支出尚需核对日期、周期或消费性质。完成后再生成强结论。</p><button onClick={() => { setTab("bills"); setPeriod("year"); setFilter("expense"); }}>核对账单</button></div>}
        {!metrics.unresolvedCount && metrics.safeToSpend < 0 && <div className="gentle-tip" role="status"><p>本周期已超出当前结构目标 {money(-metrics.safeToSpend)}。可以查看财务明细或调整目标。</p></div>}
      </>}
      <section className="section-block home-actions-section">
        <div className="section-title"><h2>接下来你可以</h2></div>
        <div className="home-action-grid">
          <button className="home-action-card" data-testid="home-action-add" onClick={() => openEntry()}><StoryIcon name="plus"/><span><b>记一笔</b><small>把刚刚的花费告诉小满</small></span></button>
          <button className="home-action-card" data-testid="home-action-bills" onClick={() => setTab("bills")}><StoryIcon name="book"/><span><b>看看这个月</b><small>消费、浪费和投资</small></span></button>
          <button className="home-action-card" data-testid="home-action-assets" onClick={() => openAssets("home")}><StoryIcon name="jar"/><span><b>我的资产</b><small>现金、投资和负债</small></span></button>
          <button className="home-action-card" data-testid="home-action-review" onClick={() => setTab("review")}><StoryIcon name="leaf"/><span><b>帮我复盘</b><small>看看这个周期发生了什么</small></span></button>
        </div>
      </section>
      <section className="section-block transactions"><div className="section-title"><h2>最近账目</h2><button onClick={() => setTab("bills")}>查看全部</button></div>{filters}{recent.length ? recent.map(tx => <TransactionRow key={tx.id} item={tx} {...rowActions} />) : <EmptyState compact text="从第一笔开始，让小满慢慢理解你的钱" action={() => openEntry()} />}</section>
      {cycle && <div ref={dockRef} className="assistant-dock" aria-label="与小满对话">
        <div className="assistant-prompts" aria-label="快捷问题">{QUICK_QUESTIONS.map(question => <button key={question} type="button" onClick={() => { setAssistantQuestion(question); questionRef.current?.focus(); }}>{question}</button>)}</div>
        <p id="assistant-availability" className="assistant-provider-note">AI 分析暂未启用 · 记账与财务看板可正常使用</p>
        <form className="assistant-composer" onSubmit={submitAssistantQuestion}>
          <label className="sr-only" htmlFor="assistant-question">问小满</label>
          <input ref={questionRef} id="assistant-question" aria-describedby="assistant-availability" value={assistantQuestion} onChange={event => setAssistantQuestion(event.target.value)} placeholder="问小满：我这个月还能花多少？" autoComplete="off" enterKeyHint="send" />
          <button type="submit" aria-label="发送给小满" disabled={!assistantQuestion.trim()}>发送</button>
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

    {tab === "review" && <><PageHeader title="周期复盘" subtitle={cycle ? `${cycle.startDate} 至 ${cycle.endDate}` : "先建立财务周期"} />{metrics && <><section className="stats-hero"><p>本周期实际支出</p><strong>{money(metrics.totalExpense)}</strong><p>{metrics.model === "nature" ? `投资目标 ${money(metrics.investmentTarget)} · 已发生投资 ${money(metrics.investmentSpend)}` : `旧周期计划储蓄 ${money(plan!.plannedSavings)}`}</p><p>收入记录 {money(total(cycleTransactions, "income"))}；可用收入以周期设置为准。</p></section>{budgetCard}{natureCard}<p className="helper">当前提供确定性数据复盘。AI 周期洞察会在真实 Provider 接入后启用。</p></>}</>}

    {tab === "me" && <><PageHeader title="我的" subtitle="安排周期，也照顾未来" /><section className="category-card"><h2>财务周期</h2><p>每月 {state.profile?.salaryDay ?? "—"} 日发薪 · 短月按月末</p><button className="primary" onClick={() => setModal("cycle")}>{!expired && cycle ? "调整本周期结构" : "建立新周期"}</button><p className="helper">收入记录不会重复增加本周期可支出。收入变化时，请在周期设置中确认可用收入。</p></section><button className="local-data-card" onClick={() => openAssets("me")}><span className="local-data-icon">投</span><span><b>投资账户</b><small>记录已有 ETF / 基金资产与当前市值</small></span></button><section className="goal-card saving"><p>存款目标</p><strong>{money(state.settings.savingsCurrent)} <small>/ {money(state.settings.savingsGoal)}</small></strong><button onClick={() => setModal("goal")}>更新存款目标</button></section><button className="local-data-card" onClick={() => setModal("data")}><span className="local-data-icon">本</span><span><b>本机数据与备份</b><small>换设备前，导出一份完整备份</small></span></button></>}

    {tab === "assets" && <InvestmentAccounts state={state} today={today} onBack={() => setTab(assetReturnTab)} onCreateAccount={account => commit(() => repository.saveInvestmentAccount(account, state.revision), "投资账户已创建")} onFlow={flow => commit(() => repository.saveInvestmentFlow(flow, state.revision), flow.type === "contribution" ? "投资投入已记录" : "投资取出已记录")} onMarketValue={(accountId, value, date) => commit(() => repository.saveMarketValue(accountId, value, date, state.revision), "当前市值已更新")} />}

  </fieldset>

  {(setup || modal) && <div className={`modal-wrap ${setup && !modal ? 'setup-wrap' : ''}`}><section className={`sheet ${setup && !modal ? 'setup-sheet' : ''}`} role="dialog" aria-modal="true" aria-label={setup ? "建立第一个财务周期" : modal === "add" || modal === "edit" ? "记账" : "账本设置"}>
    {(!setup || modal) && <button className="close" disabled={busy} onClick={() => { setModal(null); setEditing(null); setError(""); }} aria-label="关闭">×</button>}
    <fieldset disabled={busy} className="app-content">
      {(setup && !modal) || modal === "cycle" ? <><CycleForm key={cycle?.id ?? "first"} today={today} cycle={!expired ? cycle : undefined} plan={!expired ? plan : undefined} salaryDay={state.profile?.salaryDay} onSave={(c, p) => void commit(() => repository.saveCycle(c, p, state.revision), "周期结构已保存")} />{setup && <label>已有账本？导入完整备份<input type="file" accept="application/json,.json" onChange={event => void chooseBackup(event)} /></label>}</>
      : modal === "add" || modal === "edit" ? <EntryForm key={editing?.id ?? "new"} today={today} item={editing} cycles={state.cycles} onSave={tx => void commit(() => repository.saveTransaction(tx, state.revision, !!editing), editing ? "账目已修改" : "已记账")} />
      : modal === "delete" && editing ? <ConfirmPanel mark="删" title="确定删除这笔账？" hint="删除后无法恢复" summary={<><span>{editing.note || editing.category}</span><b>{money(editing.amount)}</b></>} cancel="保留账目" confirm="确认删除" onCancel={() => setModal(null)} onConfirm={() => void commit(() => repository.deleteTransaction(editing.id, state.revision), "账目已删除")} />
      : modal === "data" ? <DataPanel ledgerKind={state.ledgerKind} count={state.transactions.length} onKind={kind => changeState({ ...state, ledgerKind: kind }, "账本标签已保存")} onBackup={exportBackup} onCsv={exportCsv} onImport={event => void chooseBackup(event)} onClear={() => setModal("clear")} />
      : modal === "import" && pendingImport ? <ConfirmPanel mark="入" title="用备份替换当前账本？" hint={`将恢复 ${pendingImport.transactions.length} 笔账目，当前数据会被覆盖。建议先导出备份。`} cancel="暂不导入" confirm="确认恢复" onCancel={() => setModal("data")} onConfirm={() => changeState(pendingImport, "备份已恢复")} />
      : modal === "goal" ? <GoalForm saved={state.settings.savingsCurrent} goal={state.settings.savingsGoal} onSave={(current, target) => { try { cents(current); cents(target); changeState({ ...state, settings: { ...state.settings, savingsCurrent: current, savingsGoal: target } }, "存款目标已保存"); } catch (e) { setError((e as Error).message); } }} />
      : <ConfirmPanel mark="清" title="清空这台设备的账本？" hint="账目、周期和预算都会删除，无法撤销。建议先导出备份。" cancel="保留数据" confirm="确认清空" onCancel={() => setModal("data")} onConfirm={() => changeState(defaultState(), "账本已清空")} />}
    </fieldset>{busy && <p role="status">正在保存到本机…</p>}{error && <div className="error-message" role="alert">{error}<button disabled={busy} onClick={() => void reload()}>重新载入账本</button></div>}
  </section></div>}
  {error && !modal && !setup && <div className="error-message" role="alert">{error}<button onClick={() => void reload()}>重新载入账本</button></div>}
  {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}
