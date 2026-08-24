"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { CATEGORY_ICONS, EXPENSE_CATEGORIES, classifyTransaction, type LedgerCategory } from "../lib/classify";

type Tab = "home" | "bills" | "stats" | "goals";
type Period = "day" | "week" | "month" | "year";
type TxnType = "expense" | "income";
type HomeFilter = "all" | TxnType;
type Modal = "add" | "edit" | "delete" | "budget" | "goal" | "data" | "import" | "clear" | null;
type EntrySource = "text" | "voice" | "import";
type LedgerKind = "personal" | "family" | "travel";
type Transaction = { id: string; type: TxnType; category: string; note: string; amount: number; date: string; icon: string; source: EntrySource };
type LedgerState = {
  app: "xiaoman-ledger";
  version: 1;
  ledgerKind: LedgerKind;
  transactions: Transaction[];
  settings: { monthlyBudget: number; savingsCurrent: number; savingsGoal: number };
  exportedAt?: string;
};

const DB_NAME = "xiaoman-ledger-db";
const STORE_NAME = "ledger";
const STATE_KEY = "current";
const FALLBACK_KEY = "xiaoman-ledger-local-v1";
const ONBOARDING_KEY = "xiaoman-onboarding-completed-v1";
const PERIODS: { key: Period; label: string }[] = [{ key: "day", label: "日" }, { key: "week", label: "周" }, { key: "month", label: "月" }, { key: "year", label: "年" }];
const NAV: { key: Tab; label: string }[] = [{ key: "home", label: "首页" }, { key: "bills", label: "账单" }, { key: "stats", label: "统计" }, { key: "goals", label: "目标" }];
const HOME_FILTERS: { key: HomeFilter; label: string }[] = [{ key: "all", label: "全部" }, { key: "income", label: "收入" }, { key: "expense", label: "支出" }];
const LEDGER_KINDS: { key: LedgerKind; label: string; short: string }[] = [
  { key: "personal", label: "个人账本", short: "我" },
  { key: "family", label: "家庭账本", short: "家" },
  { key: "travel", label: "旅行账本", short: "旅" },
];
const money = (n: number) => `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const progress = (current: number, total: number) => total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0;

function defaultState(): LedgerState {
  return { app: "xiaoman-ledger", version: 1, ledgerKind: "personal", transactions: [], settings: { monthlyBudget: 15000, savingsCurrent: 0, savingsGoal: 100000 } };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readLocalState(): Promise<LedgerState> {
  try {
    const db = await openDatabase();
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (stored) return normalizeBackup(stored);
  } catch {
    const fallback = localStorage.getItem(FALLBACK_KEY);
    if (fallback) return normalizeBackup(JSON.parse(fallback));
  }
  const legacy = localStorage.getItem("xiaoman-ledger");
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as Record<string, unknown>;
      const transactions = Array.isArray(parsed.transactions)
        ? parsed.transactions.filter((item) => !(typeof item === "object" && item && Number((item as { id?: unknown }).id) <= 8)).map(normalizeTransaction)
        : [];
      return { ...defaultState(), transactions, settings: { monthlyBudget: safeNumber(parsed.budget, 15000), savingsCurrent: safeNumber(parsed.saved, 0), savingsGoal: safeNumber(parsed.goal, 100000) } };
    } catch { /* Ignore malformed legacy data and start clean. */ }
  }
  return defaultState();
}

async function writeLocalState(state: LedgerState) {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(state, STATE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
  }
}

function safeNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeTransaction(value: unknown): Transaction {
  if (!value || typeof value !== "object") throw new Error("备份中含有无法识别的账目");
  const item = value as Record<string, unknown>;
  const type = item.type === "income" ? "income" : item.type === "expense" ? "expense" : null;
  const amount = Number(item.amount);
  const date = String(item.date ?? item.occurred_at ?? "");
  if (!type || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(Date.parse(date))) throw new Error("备份中含有不完整的账目");
  const category = String(item.category ?? (type === "income" ? "收入" : "其他")).slice(0, 30);
  const note = String(item.note ?? category).trim().slice(0, 100) || category;
  const source: EntrySource = item.source === "voice" || item.source === "import" ? item.source : "text";
  return { id: String(item.id || crypto.randomUUID()), type, category, note, amount, date, icon: String(item.icon ?? category.slice(0, 1)).slice(0, 1), source };
}

function normalizeBackup(value: unknown): LedgerState {
  if (!value || typeof value !== "object") throw new Error("这不是有效的小满账本备份");
  const data = value as Record<string, unknown>;
  if (data.app !== "xiaoman-ledger" || data.version !== 1 || !Array.isArray(data.transactions)) throw new Error("请选择小满账本导出的 JSON 文件");
  if (data.transactions.length > 5000) throw new Error("备份账目过多，请分批整理后再导入");
  const settings = (data.settings && typeof data.settings === "object" ? data.settings : {}) as Record<string, unknown>;
  const ledgerKind: LedgerKind = data.ledgerKind === "family" || data.ledgerKind === "travel" ? data.ledgerKind : "personal";
  return {
    app: "xiaoman-ledger", version: 1, ledgerKind,
    transactions: data.transactions.map(normalizeTransaction).sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    settings: { monthlyBudget: safeNumber(settings.monthlyBudget, 15000), savingsCurrent: safeNumber(settings.savingsCurrent, 0), savingsGoal: safeNumber(settings.savingsGoal, 100000) },
  };
}

function inPeriod(tx: Transaction, period: Period) {
  const date = new Date(tx.date); const now = new Date();
  if (period === "day") return date.toDateString() === now.toDateString();
  if (period === "week") return now.getTime() - date.getTime() <= 7 * 86400000 && date <= now;
  if (period === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return date.getFullYear() === now.getFullYear();
}

function downloadFile(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  const [period, setPeriod] = useState<Period>("month");
  const [homeFilter, setHomeFilter] = useState<HomeFilter>("all");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budget, setBudget] = useState(15000);
  const [saved, setSaved] = useState(0);
  const [goal, setGoal] = useState(100000);
  const [ledgerKind, setLedgerKind] = useState<LedgerKind>("personal");
  const [ready, setReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [pendingImport, setPendingImport] = useState<LedgerState | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<TxnType>("expense");
  const [entryText, setEntryText] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entrySource, setEntrySource] = useState<EntrySource>("text");
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    void readLocalState().then((state) => {
      setTransactions(state.transactions); setBudget(state.settings.monthlyBudget); setSaved(state.settings.savingsCurrent);
      setGoal(state.settings.savingsGoal); setLedgerKind(state.ledgerKind); setShowOnboarding(!localStorage.getItem(ONBOARDING_KEY)); setReady(true);
    }).catch(() => { setShowOnboarding(!localStorage.getItem(ONBOARDING_KEY)); setReady(true); setToast("本机数据读取失败，请先导入备份"); });
  }, []);

  useEffect(() => {
    if (!ready) return;
    void writeLocalState({ app: "xiaoman-ledger", version: 1, ledgerKind, transactions, settings: { monthlyBudget: budget, savingsCurrent: saved, savingsGoal: goal } })
      .catch(() => setToast("本机保存失败，请导出备份后重试"));
  }, [ready, ledgerKind, transactions, budget, saved, goal]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2600); return () => clearTimeout(timer); }, [toast]);

  const monthly = transactions.filter((tx) => inPeriod(tx, "month"));
  const monthIncome = monthly.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
  const monthExpense = monthly.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
  const filtered = transactions.filter((tx) => inPeriod(tx, period));
  const periodIncome = filtered.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
  const periodExpense = filtered.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
  const recent = transactions.filter((tx) => homeFilter === "all" || tx.type === homeFilter).slice(0, 4);
  const categories = (() => {
    const map = new Map<string, number>();
    filtered.filter((tx) => tx.type === "expense").forEach((tx) => map.set(tx.category, (map.get(tx.category) ?? 0) + tx.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const trendBars = filtered.filter((tx) => tx.type === "expense").slice(0, 12).reverse();
  const maxBar = Math.max(...trendBars.map((tx) => tx.amount), 1);
  const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  const ledger = LEDGER_KINDS.find((item) => item.key === ledgerKind) ?? LEDGER_KINDS[0];

  function snapshot(): LedgerState {
    return { app: "xiaoman-ledger", version: 1, ledgerKind, transactions, settings: { monthlyBudget: budget, savingsCurrent: saved, savingsGoal: goal } };
  }
  function resetEntry() { setEditingId(null); setEntryType("expense"); setEntryText(""); setEntryAmount(""); setEntrySource("text"); }
  function openEntry(item?: Transaction) {
    if (item) { setEditingId(item.id); setEntryType(item.type); setEntryText(item.note); setEntryAmount(String(item.amount)); setEntrySource(item.source); setModal("edit"); }
    else { resetEntry(); setModal("add"); }
  }
  function dismissOnboarding(startNow = false) {
    localStorage.setItem(ONBOARDING_KEY, "true"); setShowOnboarding(false);
    if (startNow) setTimeout(() => openEntry(), 180);
  }
  function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(entryAmount || entryText.match(/\d+(?:\.\d+)?/)?.[0]);
    if (!entryText.trim() || !parsedAmount || parsedAmount <= 0) { setToast("请补充事项和正确金额"); return; }
    const autoType = /收入|工资|奖金|到账|收款/.test(entryText) ? "income" : entryType;
    const automatic = classifyTransaction(entryText, autoType);
    const chosen = String(new FormData(event.currentTarget).get("category") ?? "");
    const category = autoType === "income" ? automatic.category : EXPENSE_CATEGORIES.includes(chosen as LedgerCategory) ? chosen as LedgerCategory : automatic.category;
    const icon = CATEGORY_ICONS[category];
    const cleanNote = entryText.replace(/\d+(?:\.\d+)?\s*(元|块)?/, "").replace(/[，,。]/g, "").trim() || category;
    const payload = { type: autoType, category, note: cleanNote, amount: parsedAmount, source: entrySource };
    if (editingId) {
      setTransactions((items) => items.map((item) => item.id === editingId ? { ...item, ...payload, icon } : item));
      setToast("账目已保存在本机");
    } else {
      setTransactions((items) => [{ id: crypto.randomUUID(), ...payload, icon, date: new Date().toISOString() }, ...items]);
      setToast("已记下，并保存在这台设备");
    }
    setModal(null); resetEntry();
  }
  function askDelete(item: Transaction) { setDeleteTarget(item); setModal("delete"); }
  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget; setModal(null); setRemovingId(target.id);
    setTimeout(() => { setTransactions((items) => items.filter((item) => item.id !== target.id)); setRemovingId(null); setDeleteTarget(null); setToast("账目已删除"); }, 220);
  }
  function exportBackup() {
    const backup = { ...snapshot(), exportedAt: new Date().toISOString() };
    downloadFile(JSON.stringify(backup, null, 2), "application/json", `xiaoman-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`);
    setToast("备份已下载，请妥善保存");
  }
  function exportCsv() {
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = transactions.map((item) => [new Date(item.date).toLocaleString("zh-CN"), item.type === "income" ? "收入" : "支出", item.category, item.note, item.amount.toFixed(2), item.source === "voice" ? "语音" : item.source === "import" ? "导入" : "文字"].map(escape).join(","));
    const header = ["日期", "类型", "分类", "事项", "金额", "录入方式"].map(escape).join(",");
    downloadFile(`\uFEFF${header}\n${rows.join("\n")}`, "text/csv;charset=utf-8", `xiaoman-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
    setToast("CSV 已下载，可用表格软件打开");
  }
  async function chooseBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try { setPendingImport(normalizeBackup(JSON.parse(await file.text()))); setModal("import"); }
    catch (error) { setToast(error instanceof Error ? error.message : "备份读取失败，请重新选择"); }
  }
  function confirmImport() {
    if (!pendingImport) return;
    setLedgerKind(pendingImport.ledgerKind); setTransactions(pendingImport.transactions); setBudget(pendingImport.settings.monthlyBudget);
    setSaved(pendingImport.settings.savingsCurrent); setGoal(pendingImport.settings.savingsGoal); setPendingImport(null); setModal(null); setToast("备份已恢复到这台设备");
  }
  function confirmClear() {
    const clean = defaultState(); setTransactions([]); setBudget(clean.settings.monthlyBudget); setSaved(0); setGoal(clean.settings.savingsGoal);
    setLedgerKind("personal"); setModal(null); setToast("本机账本已清空");
  }
  function startVoice() {
    type SpeechLike = { lang: string; interimResults: boolean; start: () => void; onresult: (event: { results: { 0: { 0: { transcript: string } } }[] }) => void; onend: () => void; onerror: () => void };
    const browserWindow = window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) { setToast("当前浏览器不支持语音，请使用文字输入"); return; }
    const recognition = new Recognition(); recognition.lang = "zh-CN"; recognition.interimResults = false; setListening(true);
    recognition.onresult = (event) => { setEntryText(event.results[0][0].transcript); setEntrySource("voice"); };
    recognition.onend = () => setListening(false); recognition.onerror = () => { setListening(false); setToast("没有听清，请再试一次"); }; recognition.start();
  }

  if (!ready) return <LoadingScreen text="正在打开本地账本" />;
  const rowActions = { onEdit: openEntry, onDelete: askDelete, removingId };

  return (
    <main className="app-shell">
      {tab === "home" && <>
        <header className="topbar"><div><h1>{ledger.label}</h1><p className="eyebrow">{today}</p></div><button className="avatar" onClick={() => setModal("data")} aria-label="本地数据与备份">{ledger.short}</button></header>
        <section className="balance-card"><div className="balance-top"><span>本月结余</span><span className="card-mark local-mark">仅存此设备</span></div><strong>{money(monthIncome - monthExpense)}</strong><div className="balance-stats"><div><span>收入</span><b>{money(monthIncome)}</b></div><i /><div><span>支出</span><b>{money(monthExpense)}</b></div></div></section>
        <button className="quick-entry" onClick={() => openEntry()}><div><span className="live-dot" /><span>说一句或输入一笔账</span></div><span className="mic"><i />语音</span></button>
        <section className="section-block"><div className="section-title"><h2>本月概览</h2><button onClick={() => setTab("stats")}>查看分析</button></div><button className="budget-box" onClick={() => setModal("budget")}><div className="budget-row"><span>支出预算</span><b>{money(monthExpense)} <small>/ {money(budget)}</small></b></div><span className="progress"><i style={{ width: `${progress(monthExpense, budget)}%` }} /></span><span className="budget-foot"><i>已用 {progress(monthExpense, budget)}%</i><i>还可支出 {money(Math.max(0, budget - monthExpense))}</i></span></button></section>
        <section className="section-block transactions recent-section"><div className="section-title"><h2>最近账目</h2><button onClick={() => setTab("bills")}>查看账单</button></div><div className="recent-filters" role="tablist" aria-label="筛选最近账目">{HOME_FILTERS.map((item) => <button role="tab" aria-selected={homeFilter === item.key} className={homeFilter === item.key ? "active" : ""} key={item.key} onClick={() => setHomeFilter(item.key)}>{item.label}</button>)}</div><div className="recent-list" key={homeFilter}>{recent.length ? recent.map((item) => <TransactionRow key={item.id} item={item} {...rowActions} />) : <EmptyState compact text={transactions.length ? `还没有${homeFilter === "income" ? "收入" : homeFilter === "expense" ? "支出" : "账目"}` : "从第一笔开始，慢慢看见自己的生活"} action={transactions.length ? undefined : () => openEntry()} />}</div></section>
      </>}

      {tab === "bills" && <><PageHeader title="账单" subtitle="每一笔，都清清楚楚" /><PeriodTabs period={period} setPeriod={setPeriod} /><section className="bill-summary"><div><span>收入</span><b>{money(periodIncome)}</b></div><div><span>支出</span><b>{money(periodExpense)}</b></div><div><span>结余</span><b className="green">{money(periodIncome - periodExpense)}</b></div></section><div className="list-label"><span>{filtered.length} 笔账目</span><span>点击账目即可编辑</span></div><section className="transactions bill-list">{filtered.length ? filtered.map((item) => <TransactionRow key={item.id} item={item} {...rowActions} />) : <EmptyState text="这个周期还没有账目" action={() => openEntry()} />}</section></>}

      {tab === "stats" && <><PageHeader title="收支统计" subtitle="看见钱都花在了哪里" /><PeriodTabs period={period} setPeriod={setPeriod} />{filtered.length ? <><section className="stats-hero"><p>支出总额</p><strong>{money(periodExpense)}</strong><span className="trend">共记录 {filtered.length} 笔账目</span><div className="bars" aria-label="支出趋势图">{trendBars.map((item) => <i key={item.id} style={{ height: `${Math.max(8, item.amount / maxBar * 100)}%` }} />)}</div></section><section className="section-block category-card"><div className="section-title"><h2>支出分类</h2><span>共 {categories.length} 类</span></div>{categories.map(([name, amount], index) => <div className="category-row" key={name}><span className={`rank rank-${index}`}>{index + 1}</span><div><b>{name}</b><span className="category-bar"><i style={{ width: `${periodExpense ? Math.max(8, amount / periodExpense * 100) : 0}%` }} /></span></div><p><b>{money(amount)}</b><span>{periodExpense ? Math.round(amount / periodExpense * 100) : 0}%</span></p></div>)}</section></> : <EmptyState text="记下几笔账后，这里会生成收支趋势" action={() => openEntry()} />}</>}

      {tab === "goals" && <><PageHeader title="预算与目标" subtitle="把想要的生活，一点点存下来" /><section className="goal-card saving"><span className="goal-icon" aria-hidden="true" /><p>年度存款目标</p><strong>{money(saved)} <small>/ {money(goal)}</small></strong><span className="progress"><i style={{ width: `${progress(saved, goal)}%` }} /></span><div><span>已完成 {progress(saved, goal)}%</span><span>还差 {money(Math.max(0, goal - saved))}</span></div><button onClick={() => setModal("goal")}>更新进度</button></section><section className="goal-card budget-goal"><span className="goal-icon" aria-hidden="true" /><p>本月支出预算</p><strong>{money(monthExpense)} <small>/ {money(budget)}</small></strong><span className="progress"><i style={{ width: `${progress(monthExpense, budget)}%` }} /></span><div><span>已使用 {progress(monthExpense, budget)}%</span><span>剩余 {money(Math.max(0, budget - monthExpense))}</span></div><button onClick={() => setModal("budget")}>调整预算</button></section><button className="local-data-card" onClick={() => setModal("data")}><span className="local-data-icon" aria-hidden="true">本</span><span><b>本机数据与备份</b><small>换手机前，记得导出一份备份</small></span><i>管理</i></button></>}

      <nav className="bottom-nav" aria-label="主要导航">{NAV.slice(0, 2).map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><span className="nav-mark" aria-hidden="true" />{item.label}</button>)}<button className="add" aria-label="添加账目" onClick={() => openEntry()}>＋</button>{NAV.slice(2).map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><span className="nav-mark" aria-hidden="true" />{item.label}</button>)}</nav>

      {showOnboarding && <div className="onboarding-wrap" role="dialog" aria-modal="true" aria-label="欢迎使用小满账本"><section className="onboarding-card"><div className="onboarding-visual" aria-hidden="true"><span className="voice-orb">声</span><span className="wave"><i /><i /><i /><i /><i /></span></div><h2>不注册，也能马上记账</h2><span className="onboarding-copy">账目只保存在这台设备，不会上传云端。换手机前，从“本机数据与备份”导出文件即可带走。</span><div className="onboarding-kinds" role="radiogroup" aria-label="选择账本用途">{LEDGER_KINDS.map((item) => <button role="radio" aria-checked={ledgerKind === item.key} className={ledgerKind === item.key ? "selected" : ""} key={item.key} onClick={() => setLedgerKind(item.key)}><b>{item.short}</b>{item.label}</button>)}</div><span className="kind-note">用途只作为本机标签，不用于识别身份</span><button className="primary" onClick={() => dismissOnboarding(true)}>记下第一笔</button><button className="skip" onClick={() => dismissOnboarding(false)}>先看看账本</button></section></div>}

      {modal && <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={modal === "delete" ? "确认删除" : modal === "edit" ? "编辑账目" : modal === "import" ? "确认导入" : modal === "clear" ? "确认清空" : "设置"}><section className="sheet"><button className="close" onClick={() => { setModal(null); setPendingImport(null); resetEntry(); }} aria-label="关闭">×</button>{modal === "add" || modal === "edit" ? <EntryForm modal={modal} entryType={entryType} entryText={entryText} entryAmount={entryAmount} listening={listening} onType={setEntryType} onText={(value) => { setEntryText(value); setEntrySource("text"); }} onAmount={setEntryAmount} onVoice={startVoice} onSubmit={saveEntry} /> : modal === "delete" && deleteTarget ? <ConfirmPanel mark="删" title="确定删除这笔账？" hint="删除后无法恢复" summary={<><span>{deleteTarget.note}</span><b>{deleteTarget.type === "income" ? "+" : "-"}{money(deleteTarget.amount)}</b></>} cancel="保留账目" confirm="确认删除" onCancel={() => { setModal(null); setDeleteTarget(null); }} onConfirm={confirmDelete} /> : modal === "budget" ? <SettingForm title="设置每月预算" hint="给支出一个舒服的边界" value={budget} button="保存预算" onSave={(value) => { setBudget(value); setModal(null); setToast("预算已保存在本机"); }} /> : modal === "goal" ? <GoalForm saved={saved} goal={goal} onSave={(current, target) => { setSaved(current); setGoal(target); setModal(null); setToast("目标已保存在本机"); }} /> : modal === "data" ? <DataPanel ledgerKind={ledgerKind} count={transactions.length} onKind={setLedgerKind} onBackup={exportBackup} onCsv={exportCsv} onImport={chooseBackup} onClear={() => setModal("clear")} /> : modal === "import" && pendingImport ? <ConfirmPanel mark="入" title="用备份替换当前账本？" hint={`将恢复 ${pendingImport.transactions.length} 笔账目，当前数据会被覆盖`} cancel="暂不导入" confirm="确认恢复" onCancel={() => { setPendingImport(null); setModal("data"); }} onConfirm={confirmImport} /> : <ConfirmPanel mark="清" title="清空这台设备的账本？" hint="账目、预算和存款目标都会删除。此操作无法撤销。" cancel="保留数据" confirm="确认清空" onCancel={() => setModal("data")} onConfirm={confirmClear} />}</section></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function EntryForm({ modal, entryType, entryText, entryAmount, listening, onType, onText, onAmount, onVoice, onSubmit }: { modal: "add" | "edit"; entryType: TxnType; entryText: string; entryAmount: string; listening: boolean; onType: (type: TxnType) => void; onText: (value: string) => void; onAmount: (value: string) => void; onVoice: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [manualCategory, setManualCategory] = useState<LedgerCategory | null>(null);
  const automaticCategory = classifyTransaction(entryText, entryType).category;
  const selectedCategory = entryType === "income" ? "收入" : manualCategory ?? automaticCategory;
  const categories = entryType === "income" ? ["收入" as LedgerCategory] : EXPENSE_CATEGORIES;
  return <form onSubmit={onSubmit}><div className="sheet-head"><span>{modal === "edit" ? "改" : "记"}</span><div><p>{modal === "edit" ? "调整这笔记录" : "快速记账"}</p><h2>{modal === "edit" ? "编辑账目" : "今天花了什么？"}</h2></div></div><div className="type-tabs"><button type="button" className={entryType === "expense" ? "selected" : ""} onClick={() => { setManualCategory(null); onType("expense"); }}>支出</button><button type="button" className={entryType === "income" ? "selected" : ""} onClick={() => { setManualCategory(null); onType("income"); }}>收入</button></div><label>事项<input maxLength={100} value={entryText} onChange={(event) => { setManualCategory(null); onText(event.target.value); }} placeholder="例如：指甲油 37.8 元" /></label><fieldset className="category-field"><legend>分类 <span>{entryType === "expense" ? "已自动判断，可修改" : "根据收支类型"}</span></legend><input type="hidden" name="category" value={selectedCategory} /><div className="category-picker">{categories.map((category) => <button type="button" aria-pressed={selectedCategory === category} className={selectedCategory === category ? "selected" : ""} key={category} onClick={() => setManualCategory(category)}>{CATEGORY_ICONS[category]}<span>{category}</span></button>)}</div></fieldset><label>金额（可不填，自动识别）<div className="amount-field"><span>¥</span><input inputMode="decimal" value={entryAmount} onChange={(event) => onAmount(event.target.value)} placeholder="0.00" /></div></label>{modal === "add" && <button type="button" className={`voice-button ${listening ? "listening" : ""}`} onClick={onVoice}><span className="voice-label">声</span>{listening ? "正在听，请说…" : "用语音说一句记账"}</button>}<button className="primary" type="submit">{modal === "edit" ? "保存修改" : "确认记账"}</button></form>;
}
function LoadingScreen({ text }: { text: string }) { return <main className="loading-screen"><span className="brand-seal">满</span><p>{text}</p><i /></main>; }
function TransactionRow({ item, onEdit, onDelete, removingId }: { item: Transaction; onEdit: (item: Transaction) => void; onDelete: (item: Transaction) => void; removingId: string | null }) { const date = new Date(item.date); const isToday = date.toDateString() === new Date().toDateString(); return <article className={`tx-row ${removingId === item.id ? "removing" : ""}`}><button className="tx-main" onClick={() => onEdit(item)} aria-label={`编辑${item.note}`}><span className={`tx-icon ${item.type}`}>{item.icon}</span><span className="tx-copy"><b>{item.note}</b><small>{item.category} · {isToday ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : `${date.getMonth() + 1}月${date.getDate()}日`}</small></span><strong className={item.type}>{item.type === "income" ? "+" : "-"}{money(item.amount)}</strong></button><span className="tx-actions"><button onClick={() => onEdit(item)}>编辑</button><button onClick={() => onDelete(item)}>删除</button></span></article>; }
function PageHeader({ title, subtitle }: { title: string; subtitle: string }) { return <header className="page-header"><h1>{title}</h1><p>{subtitle}</p></header>; }
function PeriodTabs({ period, setPeriod }: { period: Period; setPeriod: (period: Period) => void }) { return <div className="period-tabs">{PERIODS.map((item) => <button key={item.key} className={period === item.key ? "active" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>; }
function EmptyState({ text, action, compact = false }: { text: string; action?: () => void; compact?: boolean }) { return <div className={`empty ${compact ? "compact" : ""}`}><span className="empty-mark" aria-hidden="true" /><p>{text}</p>{action && <button onClick={action}>记下第一笔</button>}</div>; }
function SettingForm({ title, hint, value, button, onSave }: { title: string; hint: string; value: number; button: string; onSave: (value: number) => void }) { const [draft, setDraft] = useState(String(value)); return <form onSubmit={(event) => { event.preventDefault(); onSave(Number(draft) || value); }}><div className="sheet-head"><span>¥</span><div><p>{hint}</p><h2>{title}</h2></div></div><label>预算金额<div className="amount-field"><span>¥</span><input inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} /></div></label><div className="quick-values">{[10000, 15000, 20000].map((amount) => <button type="button" key={amount} onClick={() => setDraft(String(amount))}>{amount / 10000} 万</button>)}</div><button className="primary">{button}</button></form>; }
function GoalForm({ saved, goal, onSave }: { saved: number; goal: number; onSave: (saved: number, goal: number) => void }) { const [current, setCurrent] = useState(String(saved)); const [target, setTarget] = useState(String(goal)); return <form onSubmit={(event) => { event.preventDefault(); onSave(Number(current) || 0, Number(target) || goal); }}><div className="sheet-head"><span>存</span><div><p>每一步都算数</p><h2>更新存款目标</h2></div></div><label>目前已存<div className="amount-field"><span>¥</span><input inputMode="decimal" value={current} onChange={(event) => setCurrent(event.target.value)} /></div></label><label>目标金额<div className="amount-field"><span>¥</span><input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} /></div></label><button className="primary">保存目标</button></form>; }
function ConfirmPanel({ mark, title, hint, summary, cancel, confirm, onCancel, onConfirm }: { mark: string; title: string; hint: string; summary?: React.ReactNode; cancel: string; confirm: string; onCancel: () => void; onConfirm: () => void }) { return <div className="delete-confirm"><div className="sheet-head"><span>{mark}</span><div><p>{hint}</p><h2>{title}</h2></div></div>{summary && <div className="delete-summary">{summary}</div>}<div className="confirm-actions"><button onClick={onCancel}>{cancel}</button><button className="danger" onClick={onConfirm}>{confirm}</button></div></div>; }
function DataPanel({ ledgerKind, count, onKind, onBackup, onCsv, onImport, onClear }: { ledgerKind: LedgerKind; count: number; onKind: (kind: LedgerKind) => void; onBackup: () => void; onCsv: () => void; onImport: (event: ChangeEvent<HTMLInputElement>) => void; onClear: () => void }) {
  return <div className="data-panel"><div className="sheet-head"><span>本</span><div><p>无需账户，也不上传云端</p><h2>本机数据与备份</h2></div></div><div className="local-privacy"><b>只保存在这台设备</b><p>清理浏览器数据或更换手机前，请先导出 JSON 备份。</p><span>{count} 笔账目</span></div><div className="data-section"><span>账本用途</span><div className="data-kinds">{LEDGER_KINDS.map((item) => <button key={item.key} className={ledgerKind === item.key ? "selected" : ""} onClick={() => onKind(item.key)}>{item.label}</button>)}</div></div><div className="data-actions"><button onClick={onBackup}><b>导出完整备份</b><span>换手机时用于恢复 · JSON</span></button><label><b>导入备份</b><span>替换当前设备上的账本</span><input type="file" accept="application/json,.json" onChange={onImport} /></label><button onClick={onCsv}><b>导出表格</b><span>用 Excel 或 Numbers 查看 · CSV</span></button></div><button className="clear-data" onClick={onClear}>清空这台设备的数据</button></div>;
}

