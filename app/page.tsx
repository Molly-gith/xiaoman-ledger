"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { LedgerKind, LedgerState, Transaction } from "../lib/domain/types";
import { localDate } from "../lib/domain/finance";
import { calendarMonthRange, createDateRange, summarizeDateRange, transactionsInDateRange } from "../lib/domain/date-range";
import { defaultState, encodeBackup, normalizeBackup } from "../lib/data/schema";
import { CycleForm, EntryForm } from "./ledger-forms";
import { InvestmentAccounts } from "./investment-accounts";
import { AssistantLedger } from "./assistant-ledger";
import { AssistantMemoryPanel } from "./assistant-memory-panel";
import { AccountShell, type WorkspaceScope } from "./account-shell";
import { AccountPanel } from "./account-panel";
import { StoryIcon } from "./story-icons";
import { PeriodReviewPanel } from "./period-review";
import { ConfirmPanel, DataPanel, EmptyState, GoalForm, LEDGER_KINDS, LoadingScreen, PageHeader, TransactionRow, money } from "./ledger-components";

type Tab = "home" | "bills" | "me" | "assets";
type Modal = "add" | "edit" | "delete" | "cycle" | "data" | "import" | "clear" | "goal" | "books" | "memory" | null;
const AI_API_URL = import.meta.env.VITE_AI_API_URL?.trim() ?? "";
const MAX_BACKUP_BYTES = 50_000_000;
const FILTERS = [{ key: "all", label: "全部" }, { key: "income", label: "收入" }, { key: "expense", label: "支出" }] as const;
function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function Home() {
  return <AccountShell>{scope => <LedgerHome scope={scope} />}</AccountShell>;
}

function LedgerHome({ scope }: { scope: WorkspaceScope }) {
  const { repository, memoryRepository, memoryOwnerId, isCurrent } = scope;
  const cloud = scope.mode === "account";
  const [state, setState] = useState<LedgerState | null>(null);
  const [today, setToday] = useState(() => localDate());
  const [tab, setTab] = useState<Tab>("home");
  const [modal, setModal] = useState<Modal>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [pendingImport, setPendingImport] = useState<LedgerState | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const [rangeMode, setRangeMode] = useState<"month" | "custom">("month");
  const [startDate, setStartDate] = useState(() => calendarMonthRange(localDate().slice(0, 7)).startDate);
  const [endDate, setEndDate] = useState(() => localDate());
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [prompt, setPrompt] = useState("");
  const [promptVersion, setPromptVersion] = useState(0);
  const [undo, setUndo] = useState<{ ids: string[]; revision: number } | null>(null);
  const shell = useRef<HTMLElement>(null);
  const showDialog = !!state && modal !== null;

  useEffect(() => {
    let active = true;
    void repository.read().then(value => { if (active && isCurrent()) setState(value); }).catch(e => { if (active && isCurrent()) setError(e instanceof Error ? e.message : "账本读取失败"); });
    const timer = setInterval(() => setToday(localDate()), 30000);
    return () => { active = false; clearInterval(timer); };
  }, [repository, isCurrent]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [tab]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!showDialog) return;
    const viewport = window.visualViewport;
    const measure = () => {
      shell.current?.style.setProperty("--modal-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      shell.current?.style.setProperty("--modal-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    measure(); viewport?.addEventListener("resize", measure); viewport?.addEventListener("scroll", measure); window.addEventListener("resize", measure);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sheet = document.querySelector<HTMLElement>(".sheet");
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => [...(sheet?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') ?? [])].filter(el => el.getClientRects().length > 0);
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving.current) { setModal(null); setError(""); }
      if (event.key !== "Tab") return;
      const elements = controls(), first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey);
      viewport?.removeEventListener("resize", measure); viewport?.removeEventListener("scroll", measure); window.removeEventListener("resize", measure);
      if (previous?.isConnected) previous.focus();
    };
  }, [showDialog, modal]);

  async function commit(action: () => Promise<LedgerState>, message: string): Promise<boolean> {
    if (saving.current || !isCurrent()) return false;
    saving.current = true; setBusy(true); setError("");
    try {
      const next = await action();
      if (!isCurrent()) return false;
      setState(next); setModal(null); setEditing(null); setPendingImport(null); setUndo(null); setToast(message);
      return true;
    } catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : "保存失败，输入内容已保留"); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  async function reload() {
    if (!isCurrent() || saving.current) return false;
    // A delayed read must not replace a save that completed while it was in flight.
    saving.current = true; setBusy(true);
    try { const next = await repository.read(); if (!isCurrent()) return false; setState(next); setError(""); setModal(null); setUndo(null); setPrompt(""); setPromptVersion(value => value + 1); return true; }
    catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : "读取失败"); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  if (!state) return error ? <main className="app-shell simple-app"><PageHeader title="账本暂时无法读取" subtitle={cloud ? "仍是当前账号，未切换到本机账本" : "原有数据已保留"} /><p role="alert">{error}</p><button className="primary" onClick={() => void reload()}>重新载入</button>{cloud && <AccountPanel email={scope.email} cloud accountId={scope.accountId} isCurrent={isCurrent} onRefresh={reload} />}</main> : <LoadingScreen text={cloud ? "正在读取云端账本" : "正在打开本地账本"} />;

  let range = calendarMonthRange(month);
  let rangeError = "";
  if (rangeMode === "custom") {
    try { range = createDateRange(startDate, endDate); }
    catch { rangeError = "请选择有效日期，结束日期不能早于开始日期。"; }
  }
  const report = summarizeDateRange(state.transactions, range);
  const visible = transactionsInDateRange(state.transactions, range).filter(tx => filter === "all" || tx.type === filter);
  const recent = state.transactions.slice(0, 5);
  const ledgerName = LEDGER_KINDS.find(item => item.key === state.ledgerKind)!.label;
  const allTransactionCount = state.transactions.length + Object.values(state.otherLedgers).reduce((count, book) => count + book.transactions.length, 0);
  const cycle = state.cycles.find(c => c.id === state.activeCycleId);
  const plan = state.budgets.find(b => b.cycleId === cycle?.id);
  const expired = !!cycle && today > cycle.endDate;
  const openEntry = (tx?: Transaction) => { setError(""); setEditing(tx ?? null); setModal(tx ? "edit" : "add"); };
  const rowActions = { onEdit: openEntry, onDelete: (tx: Transaction) => { setEditing(tx); setModal("delete"); }, removingId: null };
  const changeState = (next: LedgerState, message: string, resetAssistant = false, clearAllMemory = false) => void commit(async () => {
    // Ledger CAS must succeed before any other store is touched: a stale page
    // cannot erase memories while its ledger replacement is rejected.
    const savedLedger = await repository.replace(next, state.revision);
    if (!isCurrent()) throw Error("账号已切换，请在当前账号重新载入。");
    if (resetAssistant) {
      setState(savedLedger); setPrompt(""); setPromptVersion(value => value + 1);
      try {
        const owner = memoryOwnerId ?? await memoryRepository.getLocalOwnerId();
        if (!isCurrent()) throw Error("账号已切换");
        if (clearAllMemory) await memoryRepository.clearOwner(owner); else await memoryRepository.clearOwnerConversations(owner);
      } catch { throw Error("账本内容已经更新，但助手记忆清理失败。请到「记忆与偏好」清除旧对话；清空全部数据时也需删除原有偏好。不要重复导入或清空账目。"); }
    }
    return savedLedger;
  }, message).then(saved => {
    if (saved && resetAssistant) { setPrompt(""); setPromptVersion(value => value + 1); }
  });
  const switchLedger = async (kind: LedgerKind) => {
    if (kind === state.ledgerKind) { setModal(null); return; }
    const name = LEDGER_KINDS.find(item => item.key === kind)!.label;
    if (await commit(() => repository.switchLedger(kind, state.revision), `已切换到${name}`)) {
      setPrompt(""); setPromptVersion(value => value + 1); setFilter("all");
    }
  };
  const exportBackup = () => {
    const content = JSON.stringify({ ...encodeBackup(state), exportedAt: new Date().toISOString() }, null, 2);
    if (new Blob([content]).size > MAX_BACKUP_BYTES) { setError(`完整备份超过 50 MB，暂时无法导出。账目仍保留在${cloud ? "当前账号的云端" : "本机"}，请勿清空。`); return; }
    download(content, "application/json", `xiaoman-ledger-backup-${today}.json`);
  };
  const exportCsv = () => {
    const escape = (value: string | number) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const rows = [["日期", "类型", "分类", "性质", "事项", "金额"], ...state.transactions.map(tx => [tx.date, tx.type === "income" ? "收入" : "支出", tx.category, tx.nature ?? "", tx.note, tx.amount.toFixed(2)])];
    download(`\uFEFF${rows.map(row => row.map(escape).join(",")).join("\n")}`, "text/csv;charset=utf-8", `xiaoman-${ledgerName}-${today}.csv`);
  };
  const chooseBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try { if (file.size > MAX_BACKUP_BYTES) throw new Error("请选择不超过 50 MB 的备份"); const imported = normalizeBackup(JSON.parse(await file.text())); if (!isCurrent()) return; setPendingImport(imported); setModal("import"); }
    catch (e) { setError(e instanceof Error ? e.message : "备份无效"); }
  };
  const saveAI = async (transactions: Transaction[]) => {
    const saved = await commit(() => repository.saveTransactions(transactions, state.revision), `已记入${ledgerName} · ${transactions.length} 笔`);
    if (saved) setUndo({ ids: transactions.map(tx => tx.id), revision: state.revision + 1 });
    return saved;
  };

  return <main ref={shell} className="app-shell simple-app"><fieldset className="app-content" disabled={busy} inert={showDialog}>
    <header className="topbar"><div className="storybook-brand"><StoryIcon name="leaf" /><div><h1>小满</h1><p>把日子，过成喜欢的样子</p></div></div><button className="avatar" onClick={() => setModal("data")} aria-label={cloud ? "云端数据与备份" : "本地数据与备份"}><StoryIcon name="lock" /></button></header>
    {cloud && <p className="workspace-label" data-testid="account-workspace">云端账本 · {scope.email ?? "当前账号"}</p>}
    <div className="navigation-row"><nav className="simple-navigation" aria-label="主导航">{([{ key: "home", label: "记账" }, { key: "bills", label: "账单" }, { key: "me", label: "我的" }] as const).map(item => <button key={item.key} aria-current={tab === item.key ? "page" : undefined} onClick={() => setTab(item.key)}>{item.label}</button>)}</nav><button className="current-ledger" data-testid="current-ledger" aria-label={`切换账本，当前：${ledgerName}`} onClick={() => { setError(""); setModal("books"); }}><span>{ledgerName}</span><span aria-hidden="true">⌄</span></button></div>
    <div hidden={tab !== "home"}>
      <AssistantLedger key={`${state.ledgerKind}-${promptVersion}`} memoryRepository={memoryRepository} memoryOwnerId={memoryOwnerId} cloud={cloud} ledgerState={state} ledgerName={ledgerName} endpoint={AI_API_URL} today={today} report={report} revision={state.revision} hidden={tab !== "home" || showDialog} busy={busy} suggestedPrompt={prompt} onSave={saveAI} onManual={() => openEntry()} onMemorySettings={() => setModal("memory")} readLedgerSnapshot={() => repository.read()} />
      {cloud && allTransactionCount === 0 && <p className="account-empty">这个账号还没有账目。本机旧账没有自动上传；可在「我的」查看迁移方法。</p>}
      {undo && <div className="saved-receipt" role="status"><span>已记入{ledgerName} · {undo.ids.length} 笔</span><button onClick={() => void commit(() => repository.deleteTransactions(undo.ids, undo.revision), "已撤销这次记账")}>撤销这次记账</button></div>}
      <section className="transactions section-block"><div className="section-title"><h2>最近账目</h2><button data-testid="home-action-bills" onClick={() => setTab("bills")}>查看全部</button></div>{recent.length ? recent.map(tx => <TransactionRow key={tx.id} item={tx} {...rowActions} />) : <EmptyState compact text="说说今天的第一笔收入或花费吧" />}</section>
    </div>
    {tab === "bills" && <>
      <div className="section-title report-title"><h2>账单与统计</h2><button data-testid="home-action-add" onClick={() => openEntry()}>手动记一笔</button></div>
      <section className="date-filter" aria-label="统计日期筛选">
        <div className="range-modes"><button aria-pressed={rangeMode === "month"} onClick={() => setRangeMode("month")}>按月查看</button><button aria-pressed={rangeMode === "custom"} onClick={() => setRangeMode("custom")}>自定义日期</button></div>
        {rangeMode === "month" ? <div className="month-selector"><button aria-label="上个月" disabled={month <= "1900-01"} onClick={() => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); setMonth(d.toISOString().slice(0, 7)); }}>←</button><label>月份<input type="month" aria-label="查看月份" value={month} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) && e.target.value >= "1900-01" && e.target.value <= "9998-12") setMonth(e.target.value); }} min="1900-01" max="9998-12" /></label><button aria-label="下个月" disabled={month >= "9998-12"} onClick={() => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); setMonth(d.toISOString().slice(0, 7)); }}>→</button><button onClick={() => setMonth(today.slice(0, 7))}>本月</button></div> : <div className="custom-dates"><label>开始日期<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required /></label><span>至</span><label>结束日期<input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} required /></label></div>}
        {rangeError ? <p role="alert">{rangeError}</p> : <p className="helper">{range.startDate} — {range.endDate}（含首尾两天）</p>}
      </section>
      {!rangeError && <>
        <section className="bill-summary" aria-label="所选日期收支"><div><span>收入</span><b>{money(report.income)}</b></div><div><span>支出</span><b>{money(report.expense)}</b></div><div><span>收支差额</span><b>{money(report.balance)}</b></div></section>
        <section className="nature-summary" aria-label="支出性质">{Object.entries(report.natureTotals).map(([nature, amount]) => <div key={nature}><span>{nature}</span><strong>{money(amount)}</strong></div>)}</section>
        {!!report.pendingDateCount && <p className="helper">有 {report.pendingDateCount} 笔旧账暂按本机日期计入，建议打开账目核对日期。</p>}
        <PeriodReviewPanel key={`review-${state.ledgerKind}-${range.startDate}-${range.endDate}-${state.revision}`} transactions={state.transactions} range={range} ledgerName={ledgerName} today={today} />
        <div className="section-title"><h2>明细 <small>{visible.length} 笔</small></h2><div className="recent-filters" aria-label="筛选账目">{FILTERS.map(item => <button key={item.key} aria-pressed={filter === item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div></div>
        <section className="transactions bill-list">{visible.length ? visible.map(tx => <TransactionRow key={tx.id} item={tx} {...rowActions} />) : <EmptyState text="这段时间还没有账目" action={() => openEntry()} />}</section>
      </>}
    </>}
    {tab === "me" && <>
      <PageHeader title="我的" subtitle={cloud ? "正在使用当前账号的云端账本" : "账本在这台设备，设置按需使用"} />
      <AccountPanel email={scope.email} cloud={cloud} accountId={scope.accountId} isCurrent={isCurrent} onRefresh={reload} />
      <button className="local-data-card" onClick={() => setModal("memory")}><StoryIcon name="leaf" /><span><b>助手记忆与分类偏好</b><small>查看、修改或清除小满记住的内容</small></span></button>
      <button className="local-data-card" data-testid="home-action-assets" onClick={() => setTab("assets")}><StoryIcon name="jar" /><span><b>我的资产</b><small>投资账户与当前市值</small></span></button>
      <button className="local-data-card" onClick={() => setModal("data")}><StoryIcon name="book" /><span><b>{cloud ? "云端数据与备份" : "本机数据与备份"}</b><small>导出、恢复和查看表格</small></span></button>
      <details className="optional-settings"><summary>更多设置（选填）</summary><button onClick={() => setModal("goal")}>存款目标</button><button onClick={() => setModal("cycle")}>预算计划</button><p className="helper">记账不需要设置预算。历史周期和计划仍保留；查看任意日期的收支，请到「账单」。</p>{cycle && <p className="helper">已有计划：{cycle.startDate} — {cycle.endDate}</p>}</details>
      <p className="privacy-note">需要 AI 理解时会发送输入、最近八条本账本对话及查询条件。{cloud ? "当前账目与助手记忆保存在这个账号的云端；退出后可继续使用原有本机账本。" : "当前账目与助手记忆保存在本机；登录不会自动上传旧账，换设备前请分别备份。"}</p>
    </>}
    {tab === "assets" && <InvestmentAccounts key={state.ledgerKind} state={state} today={today} onBack={() => setTab("me")} onCreateAccount={account => commit(() => repository.saveInvestmentAccount(account, state.revision), "投资账户已创建")} onFlow={flow => commit(() => repository.saveInvestmentFlow(flow, state.revision), flow.type === "contribution" ? "投资投入已记录" : "投资取出已记录")} onMarketValue={(accountId, value, date) => commit(() => repository.saveMarketValue(accountId, value, date, state.revision), "当前市值已更新")} />}
  </fieldset>
  {modal && <div className="modal-wrap"><section className="sheet" role="dialog" aria-modal="true" aria-label={modal === "books" ? "切换账本" : modal === "add" || modal === "edit" ? "记账" : "账本设置"}>
    <button className="close" disabled={busy} onClick={() => { setModal(null); setEditing(null); setError(""); }} aria-label="关闭">×</button>
    <fieldset disabled={busy} className="app-content">
      {!["books", "data", "import", "clear"].includes(modal) && <p className="sheet-ledger">当前账本：{ledgerName}</p>}
      {modal === "books" ? <div className="book-picker"><div className="sheet-head"><span><StoryIcon name="book" /></span><div><h2>切换账本</h2><p>每个账本单独记账、单独统计</p></div></div><div className="book-options">{LEDGER_KINDS.map(item => <button key={item.key} aria-label={item.label} aria-pressed={state.ledgerKind === item.key} onClick={() => void switchLedger(item.key)}><b>{item.label}</b><span>{state.ledgerKind === item.key ? "正在使用" : "切换"}</span></button>)}</div><p className="helper">切换后，未保存的输入和草稿会清除，已保存的账目会保留。</p></div> : <>
      {modal === "cycle" ? <CycleForm key={cycle?.id ?? "first"} today={today} cycle={!expired ? cycle : undefined} plan={!expired ? plan : undefined} allowCycleChange initialCycleType={cycle?.cycleType ?? "calendar_month"} salaryDay={state.profile?.salaryDay} onSave={(c, p) => void commit(() => cycle && !expired ? repository.replaceCurrentCycle(c, p, state.revision) : repository.saveCycle(c, p, state.revision), "预算计划已保存")} />
      : modal === "add" || modal === "edit" ? <EntryForm key={editing?.id ?? "new"} today={today} item={editing} cycles={state.cycles} onSave={tx => void commit(() => repository.saveTransaction(tx, state.revision, !!editing), editing ? "账目已修改" : `已记入${ledgerName}`)} />
      : modal === "delete" && editing ? <ConfirmPanel mark="删" title="确定删除这笔账？" hint="删除后无法恢复" summary={<><span>{editing.note || editing.category}</span><b>{money(editing.amount)}</b></>} cancel="保留账目" confirm="确认删除" onCancel={() => setModal(null)} onConfirm={() => void commit(() => repository.deleteTransaction(editing.id, state.revision), "账目已删除")} />
      : modal === "data" ? <DataPanel cloud={cloud} ledgerKind={state.ledgerKind} count={state.transactions.length} totalCount={allTransactionCount} onKind={kind => void switchLedger(kind)} onBackup={exportBackup} onCsv={exportCsv} onImport={event => void chooseBackup(event)} onClear={() => setModal("clear")} />
      : modal === "memory" ? <AssistantMemoryPanel memoryRepository={memoryRepository} memoryOwnerId={memoryOwnerId} cloud={cloud} ledgerKind={state.ledgerKind} ledgerName={ledgerName} onChanged={() => { setPrompt(""); setPromptVersion(value => value + 1); }} />
      : modal === "import" && pendingImport ? <ConfirmPanel mark="入" title={cloud ? "用备份替换当前账号的全部云端账本？" : "用备份替换这台设备的全部账本？"} hint={`将恢复 ${pendingImport.transactions.length + Object.values(pendingImport.otherLedgers).reduce((count, book) => count + book.transactions.length, 0)} 笔账目，个人、家庭、旅行账本均会被备份内容替换。建议先导出备份。`} cancel="暂不导入" confirm="确认恢复" onCancel={() => setModal("data")} onConfirm={() => changeState(pendingImport, "备份已恢复", true)} />
      : modal === "goal" ? <GoalForm saved={state.settings.savingsCurrent} goal={state.settings.savingsGoal} onSave={(current, target) => changeState({ ...state, settings: { ...state.settings, savingsCurrent: current, savingsGoal: target } }, "存款目标已保存")} />
      : <ConfirmPanel mark="清" title={cloud ? "清空当前账号的全部云端账本？" : "清空这台设备的全部账本？"} hint="个人、家庭、旅行账本中的账目、资产、周期、预算、对话和分类偏好都会删除，无法撤销。建议先分别导出账本和助手记忆备份。" cancel="保留数据" confirm="确认清空" onCancel={() => setModal("data")} onConfirm={() => changeState(defaultState(), "全部账本与助手记忆已清空", true, true)} />}</>}
    </fieldset>{busy && <p role="status">正在保存…</p>}{error && <div className="error-message" role="alert">{error}<button disabled={busy} onClick={() => void reload()}>重新载入账本</button></div>}
  </section></div>}
  {error && !modal && <div className="error-message" role="alert">{error}<button onClick={() => void reload()}>重新载入账本</button></div>}
  {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}
