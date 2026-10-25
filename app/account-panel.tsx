"use client";
import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { createLocalRepository } from "../lib/data/local-adapter";
import { createAssistantMemoryRepository } from "../lib/data/assistant-memory";
import { prepareLocalToCloudMigration } from "../lib/data/cloud-migration";
import { LEDGER_KINDS } from "./ledger-components";
import "./account-panel.css";

// The fixed preview return URL is verified; the email service still limits pilot signups.
export const ACCOUNT_REGISTRATION_READY = true;

function authErrorMessage(error: unknown, signup: boolean): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "invalid_credentials") return "邮箱或密码不正确，请核对后重试。";
  if (code === "email_not_confirmed") return "请先打开邮箱里的确认链接，再回来登录。";
  if (code === "email_address_not_authorized") return "这个邮箱暂未开放注册，你可以继续使用本机账本。";
  if (code === "user_already_exists") return "这个邮箱已有账号，请选择登录。";
  if (code === "weak_password") return "密码不符合要求，请使用更长、较难猜到的密码。";
  if (code.includes("rate_limit")) return "尝试次数较多，请稍后再试。";
  return signup ? "注册暂时没有完成，请检查网络后重试。本机账目仍保留。" : "账号暂时无法连接，请检查网络后重试。本机账目仍保留。";
}

export function AccountPanel({ email, cloud = false, accountId, isCurrent, onRefresh }: { email: string | null; cloud?: boolean; accountId?: string; isCurrent?: () => boolean; onRefresh?: () => Promise<boolean> }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [migration, setMigration] = useState<Awaited<ReturnType<typeof prepareLocalToCloudMigration>> | null>(null);
  async function authenticate(event: FormEvent) {
    event.preventDefault(); if (running.current) return;
    if (mode === "signup" && !ACCOUNT_REGISTRATION_READY) { setError("新账号注册尚未开放，请先使用已有账号登录。"); return; }
    running.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const credentials = { email: address.trim(), password };
      if (mode === "signup") {
        // Use the verified Supabase Site URL, never a browser-supplied redirect.
        const { data, error: failure } = await supabase.auth.signUp(credentials);
        if (failure) throw failure;
        setPassword("");
        if (!data.session) setNotice("请查看邮箱里的确认邮件，完成确认后回来登录；如果你已注册，可直接选择登录。本机账目没有上传。");
      } else {
        const { error: failure } = await supabase.auth.signInWithPassword(credentials);
        if (failure) throw failure;
        setPassword("");
      }
    } catch (failure) { setError(authErrorMessage(failure, mode === "signup")); }
    finally { running.current = false; setBusy(false); }
  }
  async function signOut() {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const { error: failure } = await supabase.auth.signOut({ scope: "local" });
      if (failure) throw failure;
    } catch { setError("退出尚未完成，请检查网络后重试。当前仍显示这个账号的账本。"); }
    finally { running.current = false; setBusy(false); }
  }
  async function refresh() {
    if (running.current || !onRefresh) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try { if (await onRefresh()) setNotice("已读取云端最新账本，助手记忆正在重新载入。"); }
    catch { setError("同步暂时没有完成，请检查网络后重试。"); }
    finally { running.current = false; setBusy(false); }
  }
  async function prepareMigration() {
    if (running.current || !accountId || !isCurrent || !isCurrent()) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try {
      // Reading local data is deliberate and starts only after this button click.
      const prepared = await prepareLocalToCloudMigration(supabase, accountId, isCurrent, createLocalRepository(), createAssistantMemoryRepository());
      if (isCurrent()) setMigration(prepared);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "暂时无法读取本机数据，请重试。"); }
    finally { running.current = false; setBusy(false); }
  }
  async function copyLocal() {
    if (running.current || !migration || !isCurrent?.()) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await migration.execute();
      if (!isCurrent()) return;
      setMigration(null);
      setNotice("本机账目、对话和偏好已复制到当前账号，本机原内容仍保留。");
      await onRefresh?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "复制未能确认，请重新同步后核对，勿重复操作。"); }
    finally { running.current = false; setBusy(false); }
  }
  return <section className="account-panel" aria-label="账号与同步">
    <h2>{cloud ? "账号与同步" : "登录与同步"}</h2>
    {cloud ? <><p className="account-email">{email ?? "已登录账号"}</p><p className="helper">正在使用这个账号的云端账本，每次保存都需要联网。其他设备使用同一账号即可读取；页面已打开时，可点重新同步。</p>
      <div className="account-actions"><button disabled={busy} onClick={() => void refresh()}>重新同步</button><button disabled={busy} onClick={() => void signOut()}>退出到本机账本</button></div>
      <div className="account-migration"><h3>带上本机旧账</h3><p className="helper">把这台设备的三个账本、对话和分类偏好复制到空白账号。本机内容会保留，确认前不会上传。</p>
        {!migration ? <button disabled={busy} onClick={() => void prepareMigration()}>复制本机数据到这个账号</button> : <div className="migration-preview"><p>将复制到 <b>{email ?? "当前账号"}</b></p><table><caption>准备复制的本机内容</caption><thead><tr><th scope="col">账本</th><th scope="col">账目</th><th scope="col">对话</th><th scope="col">偏好</th></tr></thead><tbody>{LEDGER_KINDS.map(book => <tr key={book.key}><th scope="row">{book.label}</th><td>{migration.perLedger[book.key].transactions}</td><td>{migration.perLedger[book.key].conversations}</td><td>{migration.perLedger[book.key].preferences}</td></tr>)}</tbody></table><p className="helper">共 {migration.counts.transactions} 笔账目、{migration.counts.conversations} 条对话、{migration.counts.preferences} 条偏好。本机原内容保留，已有云端内容不会被覆盖。</p><div className="account-actions"><button disabled={busy} onClick={() => { setMigration(null); setError(""); }}>暂不复制</button><button disabled={busy} className="primary" onClick={() => void copyLocal()}>确认复制到当前账号</button></div></div>}
      </div>
      <details><summary>账号已有内容，或使用其他备份</summary><p className="helper">已有内容的账号不能直接复制覆盖。若需要替换，先备份当前云端内容，再分别到「云端数据与备份」和「记忆与偏好」中导入。可退出到本机账本导出本机备份。</p></details>
    </> : <><p className="helper">现在使用本机账本，无需登录也能记账。登录后可在不同设备使用自己的云端账本，本机旧账不会自动上传。</p>
      <details><summary>使用账号</summary><div className="account-mode"><button aria-pressed={mode === "login"} disabled={busy} onClick={() => { setMode("login"); setError(""); setNotice(""); }}>登录已有账号</button>{ACCOUNT_REGISTRATION_READY && <button aria-pressed={mode === "signup"} disabled={busy} onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>注册新账号</button>}</div>{!ACCOUNT_REGISTRATION_READY && <p className="helper">新账号注册尚未开放。已有账号可在这里登录。</p>}
        <form onSubmit={authenticate}><fieldset disabled={busy} className="app-content account-fields">{mode === "signup" && <p className="helper">当前仅支持已获授权的体验邮箱注册。</p>}<label>邮箱（必填）<input type="email" name="email" autoComplete="email" value={address} onChange={e => setAddress(e.target.value)} maxLength={254} required /></label><label>密码（必填）<input type="password" name="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} minLength={mode === "signup" ? 8 : undefined} maxLength={128} required /></label>{mode === "signup" && <p className="helper">至少八位。注册后若收到确认邮件，请按邮件提示完成验证。</p>}<button className="primary" type="submit">{mode === "signup" ? "注册" : "登录"}</button></fieldset></form>
      </details>
    </>}
    {busy && <p role="status">正在处理，请稍候…</p>}{error && <p className="inline-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
