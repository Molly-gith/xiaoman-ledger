"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { LedgerState, Transaction } from "../lib/domain/types";
import { calculateFinance, cents, localDate, remainingDays, sumMoney, transactionDay } from "../lib/domain/finance";
import { createLocalRepository } from "../lib/data/local-adapter";
import { defaultState, normalizeBackup } from "../lib/data/schema";
import { CycleForm, EntryForm } from "./ledger-forms";
import { ConfirmPanel, DataPanel, EmptyState, GoalForm, LoadingScreen, PageHeader, PeriodTabs, TransactionRow, money, type Period } from "./ledger-components";

type Tab = "home" | "bills" | "review" | "me";
type Modal = "add" | "edit" | "delete" | "cycle" | "data" | "import" | "clear" | "goal" | null;
const NAV: { key: Tab; label: string }[] = [{ key: "home", label: "首页" }, { key: "bills", label: "账单" }, { key: "review", label: "复盘" }, { key: "me", label: "我的" }];
const FILTERS = [{ key: "all", label: "全部" }, { key: "income", label: "收入" }, { key: "expense", label: "支出" }] as const;
function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
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
  const [period, setPeriod] = useState<Period>("month");
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [modal, setModal] = useState<Modal>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [pendingImport, setPendingImport] = useState<LedgerState | null>(null);
  const [toast, setToast] = useState("");
  const [today, setToday] = useState(() => localDate());
  const showDialog = !!state && (!state.activeCycleId || modal !== null);
  const canDismiss = !!state?.activeCycleId;
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
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4000); return () => clearTimeout(timer); }, [toast]);
  async function commit(action: () => Promise<LedgerState>, message: string) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const next = await action(); setState(next); setModal(null); setEditing(null); setPendingImport(null);
      const c = next.cycles.find(c => c.id === next.activeCycleId), p = next.budgets.find(b => b.cycleId === next.activeCycleId);
      const m = c && p ? calculateFinance(c, p, next.transactions) : null;
      setToast(m && !m.unresolvedCount ? `${message} · 安心可花 ${money(m.safeToSpend)}` : message);
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试；输入内容已保留"); }
    finally { saving.current = false; setBusy(false); }
  }
  async function reload() {
    try { const next = await repository.read(); setState(next); setError(""); setModal(null); }
    catch (e) { setError(e instanceof Error ? e.message : "读取失败"); }
  }
  if (!state) return error ? <main className="app-shell"><PageHeader title="账本暂时无法读取" subtitle="原有数据已保留" /><p role="alert">{error}</p><button className="primary" onClick={() => void reload()}>重新载入</button></main> : <LoadingScreen text="正在打开本地账本" />;
  const cycle = state.cycles.find(c => c.id === state.activeCycleId);
  const plan = state.budgets.find(b => b.cycleId === cycle?.id);
  const metrics = cycle && plan ? calculateFinance(cycle, plan, state.transactions) : null;
  const expired = cycle ? today >= cycle.nextSalaryDate : false;
  const setup = !cycle;
  const visible = state.transactions.filter(tx => inPeriod(tx, period, today) && (filter === "all" || tx.type === filter));
  const cycleTransactions = state.transactions.filter(tx => tx.cycleId === cycle?.id);
  const recent = cycleTransactions.filter(tx => filter === "all" || tx.type === filter).slice(0, 4);
  const total = (items: Transaction[], type: "income" | "expense") => sumMoney(items.filter(tx => tx.type === type).map(tx => tx.amount));
  const openEntry = (tx?: Transaction) => { if (!cycle) { setModal("cycle"); return; } setError(""); setEditing(tx ?? null); setModal(tx ? "edit" : "add"); };
  const rowActions = { onEdit: openEntry, onDelete: (tx: Transaction) => { setEditing(tx); setModal("delete"); }, removingId: null };
  const changeState = (next: LedgerState, message: string) => void commit(() => repository.replace(next, state.revision), message);
  const exportBackup = () => download(JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), "application/json", `xiaoman-ledger-backup-${today}.json`);
  const exportCsv = () => {
    const escape = (value: string | number) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const rows = [["日期", "类型", "分类", "性质", "支出来源", "事项", "金额", "周期"], ...state.transactions.map(tx => [tx.date, tx.type === "income" ? "收入" : "支出", tx.category, tx.nature ?? "待确认", tx.spendKind === "reserved" ? "必要预留" : tx.spendKind === "variable" ? "可变支出" : "", tx.note, tx.amount.toFixed(2), tx.cycleId ?? "待确认"])];
    download(`\uFEFF${rows.map(row => row.map(escape).join(",")).join("\n")}`, "text/csv;charset=utf-8", `xiaoman-ledger-${today}.csv`);
  };
  const chooseBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try { if (file.size > 10_000_000) throw new Error("请选择小于 10 MB 的备份"); setPendingImport(normalizeBackup(JSON.parse(await file.text()))); setModal("import"); }
    catch (e) { setError(e instanceof Error ? e.message : "备份无效"); }
  };
  const filters = <div className="recent-filters" aria-label="筛选账目">{FILTERS.map(item => <button key={item.key} aria-pressed={filter === item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>;
  const natureCard = metrics && <section className="section-block category-card"><div className="section-title"><h2>消费 / 浪费 / 投资</h2><span>按支出金额</span></div>{metrics.natureMix.map(item => <div className="nature-row" key={item.nature}><b>{item.nature}</b><span>{money(item.amount)}</span><small>{item.percent.toFixed(1)}%</small></div>)}{!metrics.totalExpense && <p className="helper">记下第一笔后，这里会展现消费结构。</p>}</section>;
  const budgetCard = metrics && plan && <section className="section-block"><div className="section-title"><h2>本周期预算</h2><button onClick={() => setModal("cycle")}>调整预算</button></div><div className="budget-row"><span>可变支出</span><b>{money(metrics.variableSpend)} / {money(metrics.variableBudget)}</b></div><span className="progress" role="progressbar" aria-label="可变支出预算使用进度" aria-valuenow={Math.min(100, Math.max(0, metrics.budgetPercent ?? 0))}><i style={{ width: `${Math.min(100, Math.max(0, metrics.budgetPercent ?? 0))}%` }} /></span><div className="budget-foot"><span>{metrics.budgetPercent === null ? "尚无可变支出额度" : `已用 ${metrics.budgetPercent.toFixed(1)}%`}</span><span>必要预留剩余 {money(metrics.reserveRemaining)}</span></div></section>;
  return <main className="app-shell"><fieldset className="app-content" disabled={busy} inert={showDialog}>
    {tab === "home" && <><header className="topbar"><div><p className="eyebrow">小满 · 工资周期账本</p><h1>把这个周期，过得从容一点</h1></div><button className="avatar" onClick={() => setModal("data")} aria-label="本地数据与备份">满</button></header>
      {cycle && metrics && <><section className="balance-card"><div className="balance-top"><span>还能安心花多少</span><span className="card-mark">仅存此设备</span></div><strong data-testid="safe-to-spend">{metrics.unresolvedCount ? "待核对旧账" : expired ? "请开启新周期" : money(metrics.safeToSpend)}</strong><div className="balance-stats"><div><span>{expired ? "上个周期已结束" : "距下次发薪"}</span><b>{remainingDays(cycle, today)} 天</b></div><div><span>财务周期</span><b>{cycle.startDate.slice(5)} — {cycle.endDate.slice(5)}</b></div></div></section>
      {expired && <button className="primary" onClick={() => setModal("cycle")}>确认收入，开启新周期</button>}
      {!!metrics.unresolvedCount && <div className="gentle-tip"><p>{metrics.unresolvedCount} 笔旧支出尚未确认周期和支出来源。请在账单中编辑核对，完成后再显示安心可花。</p><button onClick={() => { setTab("bills"); setPeriod("year"); setFilter("expense"); }}>核对账单</button></div>}
      {!metrics.unresolvedCount && metrics.safeToSpend < 0 && <div className="gentle-tip" role="status"><p>本周期计划已超出 {money(-metrics.safeToSpend)}。可以查看账目或调整预算。</p></div>}
      <button className="quick-entry" onClick={() => openEntry()}><div><span className="live-dot" /><span>记下刚刚的一笔</span></div><span className="mic">＋</span></button>{budgetCard}{natureCard}
      <section className="section-block transactions"><div className="section-title"><h2>最近账目</h2><button onClick={() => setTab("bills")}>查看账单</button></div>{filters}{recent.length ? recent.map(tx => <TransactionRow key={tx.id} item={tx} {...rowActions} />) : <EmptyState compact text="从第一笔开始，慢慢看见自己的生活" action={() => openEntry()} />}</section></>}
    </>}
    {tab === "bills" && <><PageHeader title="账单" subtitle="每一笔，都清清楚楚 · 以下按自然日历筛选" /><PeriodTabs period={period} setPeriod={setPeriod} />{filters}<section className="bill-summary"><div><span>收入记录</span><b>{money(total(visible, "income"))}</b></div><div><span>支出记录</span><b>{money(total(visible, "expense"))}</b></div><div><span>账目</span><b>{visible.length} 笔</b></div></section><section className="transactions bill-list">{visible.length ? visible.map(tx => <TransactionRow key={tx.id} item={tx} {...rowActions} />) : <EmptyState text="这个时段还没有账目" action={() => openEntry()} />}</section></>}
    {tab === "review" && <><PageHeader title="周期复盘" subtitle={cycle ? `${cycle.startDate} 至 ${cycle.endDate}` : "先建立财务周期"} />{metrics && <><section className="stats-hero"><p>本周期实际支出</p><strong>{money(metrics.totalExpense)}</strong><p>计划储蓄 {money(plan!.plannedSavings)}（计划值，并非实际已存）</p><p>收入记录 {money(total(cycleTransactions, "income"))}；可用收入以预算确认为准。</p></section>{budgetCard}{natureCard}<p className="helper">当前提供确定性数据复盘。财务健康评分和 AI 洞察将在后续版本完善。</p></>}</>}
    {tab === "me" && <><PageHeader title="我的" subtitle="安排周期，也照顾未来" /><section className="category-card"><h2>财务周期</h2><p>每月 {state.profile?.salaryDay ?? "—"} 日发薪 · 短月按月末</p><button className="primary" onClick={() => setModal("cycle")}>{!expired && cycle ? "调整本周期预算" : "建立新周期"}</button><p className="helper">收入记录不重复增加安心可花。收入变化时，请在预算中确认可用收入。</p></section><section className="goal-card saving"><p>存款目标</p><strong>{money(state.settings.savingsCurrent)} <small>/ {money(state.settings.savingsGoal)}</small></strong><button onClick={() => setModal("goal")}>更新存款目标</button></section><button className="local-data-card" onClick={() => setModal("data")}><span className="local-data-icon">本</span><span><b>本机数据与备份</b><small>换设备前，导出一份完整备份</small></span></button></>}
    <nav className="bottom-nav" aria-label="主要导航">{NAV.slice(0, 2).map(item => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><span className="nav-mark" />{item.label}</button>)}<button className="add" aria-label="添加账目" onClick={() => openEntry()}>＋</button>{NAV.slice(2).map(item => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><span className="nav-mark" />{item.label}</button>)}</nav>
  </fieldset>
  {(setup || modal) && <div className="modal-wrap"><section className="sheet" role="dialog" aria-modal="true" aria-label={setup ? "建立第一个财务周期" : modal === "add" || modal === "edit" ? "记账" : "账本设置"}>
    {(!setup || modal) && <button className="close" disabled={busy} onClick={() => { setModal(null); setEditing(null); setError(""); }} aria-label="关闭">×</button>}
    <fieldset disabled={busy} className="app-content">
      {(setup && !modal) || modal === "cycle" ? <><CycleForm key={cycle?.id ?? "first"} today={today} cycle={!expired ? cycle : undefined} plan={!expired ? plan : undefined} salaryDay={state.profile?.salaryDay} onSave={(c, p) => void commit(() => repository.saveCycle(c, p, state.revision), "周期预算已保存")} />{setup && <label>已有账本？导入完整备份<input type="file" accept="application/json,.json" onChange={event => void chooseBackup(event)} /></label>}</>
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
