"use client";

import type { Session, User } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Tab = "home" | "bills" | "stats" | "goals" | "admin";
type Period = "day" | "week" | "month" | "year";
type TxnType = "expense" | "income";
type HomeFilter = "all" | TxnType;
type Modal = "add" | "edit" | "delete" | "budget" | "goal" | "account" | null;
type Transaction = { id: string; userId: string; type: TxnType; category: string; note: string; amount: number; date: string; icon: string; source: "text" | "voice" | "import" };
type Profile = { id: string; email: string | null; displayName: string | null; isAdmin: boolean };
type AdminData = { profiles: Profile[]; transactions: Transaction[] };

const PERIODS: { key: Period; label: string }[] = [{ key: "day", label: "日" }, { key: "week", label: "周" }, { key: "month", label: "月" }, { key: "year", label: "年" }];
const NAV: { key: Exclude<Tab, "admin">; label: string }[] = [{ key: "home", label: "首页" }, { key: "bills", label: "账单" }, { key: "stats", label: "统计" }, { key: "goals", label: "目标" }];
const HOME_FILTERS: { key: HomeFilter; label: string }[] = [{ key: "all", label: "全部" }, { key: "income", label: "收入" }, { key: "expense", label: "支出" }];
const money = (n: number) => `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const progress = (current: number, total: number) => total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0;

function inPeriod(tx: Transaction, period: Period) {
  const date = new Date(tx.date); const now = new Date();
  if (period === "day") return date.toDateString() === now.toDateString();
  if (period === "week") return now.getTime() - date.getTime() <= 7 * 86400000 && date <= now;
  if (period === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return date.getFullYear() === now.getFullYear();
}

function categoryFor(text: string, type: TxnType): [string, string] {
  if (type === "income") return ["收入", "收"];
  if (/餐|饭|早餐|午餐|晚餐|咖啡|奶茶/.test(text)) return ["餐饮", "餐"];
  if (/车|地铁|公交|打车|出行|油/.test(text)) return ["交通", "行"];
  if (/房|租|水电/.test(text)) return ["居住", "住"];
  if (/买|购物|衣|鞋|淘宝/.test(text)) return ["购物", "购"];
  if (/药|医院|健康/.test(text)) return ["健康", "医"];
  return ["其他", "其"];
}

function fromCloud(row: Record<string, unknown>): Transaction {
  const type = row.type as TxnType;
  const category = String(row.category ?? "其他");
  return {
    id: String(row.id), userId: String(row.user_id), type, category,
    note: String(row.note), amount: Number(row.amount), date: String(row.occurred_at),
    icon: category === "收入" ? "收" : category.slice(0, 1),
    source: (row.source as Transaction["source"]) ?? "text",
  };
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [period, setPeriod] = useState<Period>("month");
  const [homeFilter, setHomeFilter] = useState<HomeFilter>("all");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budget, setBudget] = useState(15000);
  const [saved, setSaved] = useState(0);
  const [goal, setGoal] = useState(100000);
  const [ready, setReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<TxnType>("expense");
  const [entryText, setEntryText] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entrySource, setEntrySource] = useState<Transaction["source"]>("text");
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState("");
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setReady(false); setProfile(null); setTransactions([]); return; }
    void loadAccount(session.user);
  }, [session]);

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2400); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (tab === "admin" && profile?.isAdmin && !adminData) void loadAdminData(); }, [tab, profile, adminData]);

  async function loadAccount(user: User) {
    setReady(false);
    const migrationKey = `xiaoman-cloud-migrated:${user.id}`;
    try {
      if (!localStorage.getItem(migrationKey)) {
        const raw = localStorage.getItem("xiaoman-ledger");
        if (raw) {
          const old = JSON.parse(raw);
          const stored = Array.isArray(old.transactions) ? old.transactions.filter((item: { id?: number }) => Number(item.id) > 8) : [];
          if (stored.length) {
            const { error } = await supabase.from("transactions").insert(stored.map((item: Record<string, unknown>) => ({
              user_id: user.id, type: item.type, category: item.category, note: item.note,
              amount: item.amount, occurred_at: item.date, source: "import",
            })));
            if (error) throw error;
          }
          await supabase.from("financial_settings").upsert({ user_id: user.id, monthly_budget: old.budget ?? 15000, savings_current: old.saved ?? 0, savings_goal: old.goal ?? 100000 });
        }
        localStorage.setItem(migrationKey, "true");
      }
      const [profileResult, settingsResult, transactionsResult] = await Promise.all([
        supabase.from("profiles").select("id,email,display_name,is_admin").eq("id", user.id).single(),
        supabase.from("financial_settings").select("monthly_budget,savings_current,savings_goal").eq("user_id", user.id).single(),
        supabase.from("transactions").select("*").eq("user_id", user.id).order("occurred_at", { ascending: false }),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (transactionsResult.error) throw transactionsResult.error;
      setProfile({ id: profileResult.data.id, email: profileResult.data.email, displayName: profileResult.data.display_name, isAdmin: profileResult.data.is_admin });
      setBudget(Number(settingsResult.data.monthly_budget)); setSaved(Number(settingsResult.data.savings_current)); setGoal(Number(settingsResult.data.savings_goal));
      setTransactions((transactionsResult.data ?? []).map((row) => fromCloud(row)));
      if (!localStorage.getItem(`xiaoman-onboarding-completed:${user.id}`)) setShowOnboarding(true);
    } catch (error) {
      setToast(error instanceof Error ? `同步失败：${error.message}` : "云端数据同步失败，请重试");
    } finally { setReady(true); }
  }

  async function loadAdminData() {
    setAdminLoading(true);
    const [profilesResult, transactionsResult] = await Promise.all([
      supabase.from("profiles").select("id,email,display_name,is_admin").order("created_at", { ascending: false }),
      supabase.from("transactions").select("*").order("occurred_at", { ascending: false }),
    ]);
    if (profilesResult.error || transactionsResult.error) setToast("后台数据读取失败，请稍后重试");
    else setAdminData({
      profiles: (profilesResult.data ?? []).map((p) => ({ id: p.id, email: p.email, displayName: p.display_name, isAdmin: p.is_admin })),
      transactions: (transactionsResult.data ?? []).map((row) => fromCloud(row)),
    });
    setAdminLoading(false);
  }

  const monthly = transactions.filter((tx) => inPeriod(tx, "month"));
  const monthIncome = monthly.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const monthExpense = monthly.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const filtered = transactions.filter((tx) => inPeriod(tx, period));
  const periodIncome = filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const periodExpense = filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const recent = transactions.filter((t) => homeFilter === "all" || t.type === homeFilter).slice(0, 4);
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    filtered.filter((t) => t.type === "expense").forEach((t) => map.set(t.category, (map.get(t.category) ?? 0) + t.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);
  const trendBars = filtered.filter((t) => t.type === "expense").slice(0, 12).reverse();
  const maxBar = Math.max(...trendBars.map((t) => t.amount), 1);
  const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());

  function resetEntry() { setEditingId(null); setEntryType("expense"); setEntryText(""); setEntryAmount(""); setEntrySource("text"); }
  function openEntry(item?: Transaction) {
    if (item) { setEditingId(item.id); setEntryType(item.type); setEntryText(item.note); setEntryAmount(String(item.amount)); setEntrySource(item.source); setModal("edit"); }
    else { resetEntry(); setModal("add"); }
  }
  function dismissOnboarding(startNow = false) {
    if (session) localStorage.setItem(`xiaoman-onboarding-completed:${session.user.id}`, "true");
    setShowOnboarding(false); if (startNow) setTimeout(() => openEntry(), 180);
  }
  async function saveEntry(e: FormEvent) {
    e.preventDefault(); if (!session) return;
    const parsedAmount = Number(entryAmount || entryText.match(/\d+(?:\.\d+)?/)?.[0]);
    if (!entryText.trim() || !parsedAmount) { setToast("请补充事项和金额"); return; }
    const autoType = /收入|工资|奖金|到账|收款/.test(entryText) ? "income" : entryType;
    const [category, icon] = categoryFor(entryText, autoType);
    const cleanNote = entryText.replace(/\d+(?:\.\d+)?\s*(元|块)?/, "").replace(/[，,。]/g, "").trim() || category;
    const payload = { type: autoType, category, note: cleanNote, amount: parsedAmount, source: entrySource };
    if (editingId) {
      const before = transactions.find((item) => item.id === editingId);
      setTransactions((items) => items.map((item) => item.id === editingId ? { ...item, ...payload, icon } : item));
      setModal(null); resetEntry();
      const { error } = await supabase.from("transactions").update(payload).eq("id", editingId).eq("user_id", session.user.id);
      if (error) { if (before) setTransactions((items) => items.map((item) => item.id === before.id ? before : item)); setToast("修改未保存，请重试"); }
      else setToast("账目已更新");
    } else {
      const temp: Transaction = { id: crypto.randomUUID(), userId: session.user.id, ...payload, icon, date: new Date().toISOString() };
      setTransactions((items) => [temp, ...items]); setModal(null); resetEntry();
      const { data, error } = await supabase.from("transactions").insert({ user_id: session.user.id, ...payload, occurred_at: temp.date }).select("*").single();
      if (error) { setTransactions((items) => items.filter((item) => item.id !== temp.id)); setToast("记账失败，请检查网络后重试"); }
      else { setTransactions((items) => items.map((item) => item.id === temp.id ? fromCloud(data) : item)); setToast("已安全保存到云端"); }
    }
  }
  function askDelete(item: Transaction) { setDeleteTarget(item); setModal("delete"); }
  async function confirmDelete() {
    if (!deleteTarget || !session) return; const target = deleteTarget;
    setModal(null); setRemovingId(target.id);
    setTimeout(async () => {
      setTransactions((items) => items.filter((item) => item.id !== target.id)); setRemovingId(null); setDeleteTarget(null);
      const { error } = await supabase.from("transactions").delete().eq("id", target.id).eq("user_id", session.user.id);
      if (error) { setTransactions((items) => [target, ...items].sort((a, b) => +new Date(b.date) - +new Date(a.date))); setToast("删除失败，账目已恢复"); }
      else setToast("账目已删除");
    }, 220);
  }
  async function saveSettings(next: { monthly_budget?: number; savings_current?: number; savings_goal?: number }) {
    if (!session) return;
    const { error } = await supabase.from("financial_settings").update(next).eq("user_id", session.user.id);
    if (error) setToast("保存失败，请重试"); else setToast("已同步到云端");
  }
  function startVoice() {
    type SpeechLike = { lang: string; interimResults: boolean; start: () => void; onresult: (e: { results: { 0: { 0: { transcript: string } } }[] }) => void; onend: () => void; onerror: () => void };
    const w = window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike };
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Recognition) { setToast("当前浏览器不支持语音，请使用文字输入"); return; }
    const recognition = new Recognition(); recognition.lang = "zh-CN"; recognition.interimResults = false; setListening(true);
    recognition.onresult = (e) => { setEntryText(e.results[0][0].transcript); setEntrySource("voice"); };
    recognition.onend = () => setListening(false); recognition.onerror = () => { setListening(false); setToast("没有听清，请再试一次"); }; recognition.start();
  }

  if (!authReady) return <LoadingScreen text="正在打开小满账本" />;
  if (!session) return <AuthScreen />;
  if (!ready) return <LoadingScreen text="正在同步你的账目" />;

  const rowActions = { onEdit: openEntry, onDelete: askDelete, removingId };
  const displayName = profile?.displayName || session.user.email?.split("@")[0] || "小满用户";

  return (
    <main className="app-shell">
      {tab === "home" && <>
        <header className="topbar"><div><h1>你好，{displayName}</h1><p className="eyebrow">{today}</p></div><button className="avatar" onClick={() => setModal("account")} aria-label="账户与设置">{displayName.slice(0, 1)}</button></header>
        <section className="balance-card"><div className="balance-top"><span>本月结余</span><span className="card-mark">云端已同步</span></div><strong>{money(monthIncome - monthExpense)}</strong><div className="balance-stats"><div><span>收入</span><b>{money(monthIncome)}</b></div><i /><div><span>支出</span><b>{money(monthExpense)}</b></div></div></section>
        <button className="quick-entry" onClick={() => openEntry()}><div><span className="live-dot" /><span>说一句或输入一笔账</span></div><span className="mic"><i />语音</span></button>
        <section className="section-block"><div className="section-title"><h2>本月概览</h2><button onClick={() => setTab("stats")}>查看分析</button></div><button className="budget-box" onClick={() => setModal("budget")}><div className="budget-row"><span>支出预算</span><b>{money(monthExpense)} <small>/ {money(budget)}</small></b></div><span className="progress"><i style={{ width: `${progress(monthExpense, budget)}%` }} /></span><span className="budget-foot"><i>已用 {progress(monthExpense, budget)}%</i><i>还可支出 {money(Math.max(0, budget - monthExpense))}</i></span></button></section>
        <section className="section-block transactions recent-section"><div className="section-title"><h2>最近账目</h2><button onClick={() => setTab("bills")}>查看账单</button></div><div className="recent-filters" role="tablist" aria-label="筛选最近账目">{HOME_FILTERS.map((item) => <button role="tab" aria-selected={homeFilter === item.key} className={homeFilter === item.key ? "active" : ""} key={item.key} onClick={() => setHomeFilter(item.key)}>{item.label}</button>)}</div><div className="recent-list" key={homeFilter}>{recent.length ? recent.map((t) => <TransactionRow key={t.id} item={t} {...rowActions} />) : <EmptyState compact text={transactions.length ? `还没有${homeFilter === "income" ? "收入" : homeFilter === "expense" ? "支出" : "账目"}` : "从第一笔开始，慢慢看见自己的生活"} action={transactions.length ? undefined : () => openEntry()} />}</div></section>
      </>}

      {tab === "bills" && <><PageHeader title="账单" subtitle="每一笔，都清清楚楚" /><PeriodTabs period={period} setPeriod={setPeriod} /><section className="bill-summary"><div><span>收入</span><b>{money(periodIncome)}</b></div><div><span>支出</span><b>{money(periodExpense)}</b></div><div><span>结余</span><b className="green">{money(periodIncome - periodExpense)}</b></div></section><div className="list-label"><span>{filtered.length} 笔账目</span><span>点击账目即可编辑</span></div><section className="transactions bill-list">{filtered.length ? filtered.map((t) => <TransactionRow key={t.id} item={t} {...rowActions} />) : <EmptyState text="这个周期还没有账目" action={() => openEntry()} />}</section></>}

      {tab === "stats" && <><PageHeader title="收支统计" subtitle="看见钱都花在了哪里" /><PeriodTabs period={period} setPeriod={setPeriod} />{filtered.length ? <><section className="stats-hero"><p>支出总额</p><strong>{money(periodExpense)}</strong><span className="trend">共记录 {filtered.length} 笔账目</span><div className="bars" aria-label="支出趋势图">{trendBars.map((item) => <i key={item.id} style={{ height: `${Math.max(8, item.amount / maxBar * 100)}%` }} />)}</div></section><section className="section-block category-card"><div className="section-title"><h2>支出分类</h2><span>共 {categories.length} 类</span></div>{categories.map(([name, amount], i) => <div className="category-row" key={name}><span className={`rank rank-${i}`}>{i + 1}</span><div><b>{name}</b><span className="category-bar"><i style={{ width: `${periodExpense ? Math.max(8, amount / periodExpense * 100) : 0}%` }} /></span></div><p><b>{money(amount)}</b><span>{periodExpense ? Math.round(amount / periodExpense * 100) : 0}%</span></p></div>)}</section></> : <EmptyState text="记下几笔账后，这里会生成收支趋势" action={() => openEntry()} />}</>}

      {tab === "goals" && <><PageHeader title="预算与目标" subtitle="把想要的生活，一点点存下来" /><section className="goal-card saving"><span className="goal-icon" aria-hidden="true" /><p>年度存款目标</p><strong>{money(saved)} <small>/ {money(goal)}</small></strong><span className="progress"><i style={{ width: `${progress(saved, goal)}%` }} /></span><div><span>已完成 {progress(saved, goal)}%</span><span>还差 {money(Math.max(0, goal - saved))}</span></div><button onClick={() => setModal("goal")}>更新进度</button></section><section className="goal-card budget-goal"><span className="goal-icon" aria-hidden="true" /><p>本月支出预算</p><strong>{money(monthExpense)} <small>/ {money(budget)}</small></strong><span className="progress"><i style={{ width: `${progress(monthExpense, budget)}%` }} /></span><div><span>已使用 {progress(monthExpense, budget)}%</span><span>剩余 {money(Math.max(0, budget - monthExpense))}</span></div><button onClick={() => setModal("budget")}>调整预算</button></section></>}

      {tab === "admin" && profile?.isAdmin && <AdminDashboard data={adminData} loading={adminLoading} onRefresh={() => { setAdminData(null); void loadAdminData(); }} onBack={() => setTab("home")} />}

      {tab !== "admin" && <nav className="bottom-nav" aria-label="主要导航">{NAV.slice(0, 2).map((n) => <button key={n.key} className={tab === n.key ? "active" : ""} onClick={() => setTab(n.key)}><span className="nav-mark" aria-hidden="true" />{n.label}</button>)}<button className="add" aria-label="添加账目" onClick={() => openEntry()}>＋</button>{NAV.slice(2).map((n) => <button key={n.key} className={tab === n.key ? "active" : ""} onClick={() => setTab(n.key)}><span className="nav-mark" aria-hidden="true" />{n.label}</button>)}</nav>}

      {showOnboarding && <div className="onboarding-wrap" role="dialog" aria-modal="true" aria-label="欢迎使用小满账本"><section className="onboarding-card"><div className="onboarding-visual" aria-hidden="true"><span className="voice-orb">声</span><span className="wave"><i /><i /><i /><i /><i /></span></div><h2>说一句，就记好第一笔</h2><span className="onboarding-copy">不用先设置复杂分类。输入“午餐 38 元”，我们会帮你整理好金额和类别，并安全同步到你的账户。</span><button className="primary" onClick={() => dismissOnboarding(true)}>记下第一笔</button><button className="skip" onClick={() => dismissOnboarding(false)}>先自己看看</button></section></div>}

      {modal && <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={modal === "delete" ? "确认删除" : modal === "edit" ? "编辑账目" : "设置"} onMouseDown={(e) => { if (e.target === e.currentTarget) { setModal(null); resetEntry(); } }}><section className="sheet"><button className="close" onClick={() => { setModal(null); resetEntry(); }} aria-label="关闭">×</button>{modal === "add" || modal === "edit" ? <form onSubmit={saveEntry}><div className="sheet-head"><span>{modal === "edit" ? "改" : "记"}</span><div><p>{modal === "edit" ? "调整这笔记录" : "快速记账"}</p><h2>{modal === "edit" ? "编辑账目" : "今天花了什么？"}</h2></div></div><div className="type-tabs"><button type="button" className={entryType === "expense" ? "selected" : ""} onClick={() => setEntryType("expense")}>支出</button><button type="button" className={entryType === "income" ? "selected" : ""} onClick={() => setEntryType("income")}>收入</button></div><label>事项<input autoFocus value={entryText} onChange={(e) => { setEntryText(e.target.value); setEntrySource("text"); }} placeholder="例如：午餐 38 元" /></label><label>金额（可不填，自动识别）<div className="amount-field"><span>¥</span><input inputMode="decimal" value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} placeholder="0.00" /></div></label>{modal === "add" && <button type="button" className={`voice-button ${listening ? "listening" : ""}`} onClick={startVoice}><span className="voice-label">声</span>{listening ? "正在听，请说…" : "用语音说一句记账"}</button>}<button className="primary" type="submit">{modal === "edit" ? "保存修改" : "确认记账"}</button></form> : modal === "delete" && deleteTarget ? <div className="delete-confirm"><div className="sheet-head"><span>删</span><div><p>删除后无法恢复</p><h2>确定删除这笔账？</h2></div></div><div className="delete-summary"><span>{deleteTarget.note}</span><b>{deleteTarget.type === "income" ? "+" : "-"}{money(deleteTarget.amount)}</b></div><div className="confirm-actions"><button onClick={() => { setModal(null); setDeleteTarget(null); }}>保留账目</button><button className="danger" onClick={confirmDelete}>确认删除</button></div></div> : modal === "budget" ? <SettingForm title="设置每月预算" hint="给支出一个舒服的边界" value={budget} button="保存预算" onSave={(v) => { setBudget(v); setModal(null); void saveSettings({ monthly_budget: v }); }} /> : modal === "goal" ? <GoalForm saved={saved} goal={goal} onSave={(s, g) => { setSaved(s); setGoal(g); setModal(null); void saveSettings({ savings_current: s, savings_goal: g }); }} /> : <AccountPanel profile={profile} email={session.user.email ?? ""} onAdmin={profile?.isAdmin ? () => { setModal(null); setTab("admin"); } : undefined} onSignOut={() => void supabase.auth.signOut()} />}</section></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setMessage("");
    if (!email || password.length < 6) { setMessage("请输入邮箱，密码至少 6 位"); return; }
    setBusy(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage("登录失败，请检查邮箱和密码");
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name.trim() || email.split("@")[0] } } });
      if (error) setMessage(error.message.includes("registered") ? "这个邮箱已注册，请直接登录" : `注册失败：${error.message}`);
      else if (!data.session) setMessage("确认邮件已发送，请查收后回来登录");
    }
    setBusy(false);
  }
  return <main className="auth-shell"><section className="auth-brand"><span className="brand-seal">满</span><div><h1>小满账本</h1><p>每一笔，都只属于你</p></div></section><section className="auth-card"><div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>登录</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setMessage(""); }}>注册</button></div><form onSubmit={submit}>{mode === "signup" && <label>怎么称呼你<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：小满" /></label>}<label>邮箱<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label><label>密码<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" /></label>{message && <p className="auth-message" role="status">{message}</p>}<button className="primary" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登录并查看我的账本" : "创建我的账本"}</button></form><p className="privacy-note">账目按账户隔离存储。其他用户无法查看你的数据。</p></section></main>;
}

function LoadingScreen({ text }: { text: string }) { return <main className="loading-screen"><span className="brand-seal">满</span><p>{text}</p><i /></main>; }
function TransactionRow({ item, onEdit, onDelete, removingId }: { item: Transaction; onEdit: (item: Transaction) => void; onDelete: (item: Transaction) => void; removingId: string | null }) { const d = new Date(item.date); const today = d.toDateString() === new Date().toDateString(); return <article className={`tx-row ${removingId === item.id ? "removing" : ""}`}><button className="tx-main" onClick={() => onEdit(item)} aria-label={`编辑${item.note}`}><span className={`tx-icon ${item.type}`}>{item.icon}</span><span className="tx-copy"><b>{item.note}</b><small>{item.category} · {today ? `今天 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : `${d.getMonth() + 1}月${d.getDate()}日`}</small></span><strong className={item.type}>{item.type === "income" ? "+" : "-"}{money(item.amount)}</strong></button><span className="tx-actions"><button onClick={() => onEdit(item)}>编辑</button><button onClick={() => onDelete(item)}>删除</button></span></article>; }
function PageHeader({ title, subtitle }: { title: string; subtitle: string }) { return <header className="page-header"><h1>{title}</h1><p>{subtitle}</p></header>; }
function PeriodTabs({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) { return <div className="period-tabs">{PERIODS.map((p) => <button key={p.key} className={period === p.key ? "active" : ""} onClick={() => setPeriod(p.key)}>{p.label}</button>)}</div>; }
function EmptyState({ text, action, compact = false }: { text: string; action?: () => void; compact?: boolean }) { return <div className={`empty ${compact ? "compact" : ""}`}><span className="empty-mark" aria-hidden="true" /><p>{text}</p>{action && <button onClick={action}>记下第一笔</button>}</div>; }
function SettingForm({ title, hint, value, button, onSave }: { title: string; hint: string; value: number; button: string; onSave: (v: number) => void }) { const [draft, setDraft] = useState(String(value)); return <form onSubmit={(e) => { e.preventDefault(); onSave(Number(draft) || value); }}><div className="sheet-head"><span>¥</span><div><p>{hint}</p><h2>{title}</h2></div></div><label>预算金额<div className="amount-field"><span>¥</span><input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} /></div></label><div className="quick-values">{[10000, 15000, 20000].map((v) => <button type="button" key={v} onClick={() => setDraft(String(v))}>{v / 10000} 万</button>)}</div><button className="primary">{button}</button></form>; }
function GoalForm({ saved, goal, onSave }: { saved: number; goal: number; onSave: (s: number, g: number) => void }) { const [s, setS] = useState(String(saved)); const [g, setG] = useState(String(goal)); return <form onSubmit={(e) => { e.preventDefault(); onSave(Number(s) || 0, Number(g) || goal); }}><div className="sheet-head"><span>存</span><div><p>每一步都算数</p><h2>更新存款目标</h2></div></div><label>目前已存<div className="amount-field"><span>¥</span><input inputMode="decimal" value={s} onChange={(e) => setS(e.target.value)} /></div></label><label>目标金额<div className="amount-field"><span>¥</span><input inputMode="decimal" value={g} onChange={(e) => setG(e.target.value)} /></div></label><button className="primary">保存目标</button></form>; }
function AccountPanel({ profile, email, onAdmin, onSignOut }: { profile: Profile | null; email: string; onAdmin?: () => void; onSignOut: () => void }) { return <div className="account-panel"><div className="sheet-head"><span>{(profile?.displayName || email).slice(0, 1)}</span><div><p>当前账户</p><h2>{profile?.displayName || "小满用户"}</h2></div></div><div className="account-email"><span>登录邮箱</span><b>{email}</b></div>{onAdmin && <button className="admin-entry" onClick={onAdmin}>进入数据分析后台<span>管理员专属</span></button>}<button className="signout" onClick={onSignOut}>退出登录</button></div>; }

function AdminDashboard({ data, loading, onRefresh, onBack }: { data: AdminData | null; loading: boolean; onRefresh: () => void; onBack: () => void }) {
  const totalIncome = data?.transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0) ?? 0;
  const totalExpense = data?.transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0) ?? 0;
  const activeUsers = new Set(data?.transactions.map((t) => t.userId)).size;
  const recent = data?.transactions.slice(0, 8) ?? [];
  return <section className="admin-view"><header className="admin-head"><button onClick={onBack}>返回账本</button><div><h1>数据分析后台</h1><p>全平台运营概览 · 只读</p></div><button onClick={onRefresh} disabled={loading}>刷新</button></header>{loading || !data ? <div className="admin-loading">正在汇总平台数据…</div> : <><section className="admin-metrics"><article><span>注册用户</span><strong>{data.profiles.length}</strong><small>{activeUsers} 位已有账目</small></article><article><span>累计账目</span><strong>{data.transactions.length}</strong><small>收入与支出记录</small></article><article><span>累计收入</span><strong>{money(totalIncome)}</strong><small>平台用户合计</small></article><article><span>累计支出</span><strong>{money(totalExpense)}</strong><small>平台用户合计</small></article></section><section className="admin-panel"><div className="section-title"><h2>最近平台账目</h2><span>仅管理员可见</span></div>{recent.length ? recent.map((t) => { const owner = data.profiles.find((p) => p.id === t.userId); return <div className="admin-row" key={t.id}><div><b>{t.note}</b><span>{owner?.displayName || owner?.email || "用户"} · {new Date(t.date).toLocaleDateString("zh-CN")}</span></div><strong className={t.type}>{t.type === "income" ? "+" : "-"}{money(t.amount)}</strong></div>; }) : <p className="admin-empty">还没有平台账目</p>}</section><section className="admin-panel"><div className="section-title"><h2>用户账户</h2><span>{data.profiles.length} 人</span></div>{data.profiles.slice(0, 12).map((p) => <div className="user-row" key={p.id}><span>{(p.displayName || p.email || "用").slice(0, 1)}</span><div><b>{p.displayName || "未设置昵称"}</b><small>{p.email}</small></div>{p.isAdmin && <i>管理员</i>}</div>)}</section></>}</section>;
}

