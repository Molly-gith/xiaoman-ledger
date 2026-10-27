"use client";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { LedgerKind } from "../lib/domain/types";
import { localDate } from "../lib/domain/finance";
import { CompanionPreferencesForm } from "./companion-preferences";
import { EXPENSE_CATEGORIES, type PreferenceRule } from "../lib/domain/assistant-preferences";
import { createAssistantMemoryRepository, validateOwnerMemoryBackup, MAX_MEMORY_BACKUP_BYTES, type AssistantMemoryRepository, type MemoryState, type OwnerMemoryBackup, type MemoryRevisions } from "../lib/data/assistant-memory";

export function AssistantMemoryPanel({ ledgerKind, ledgerName, onChanged, memoryRepository, memoryOwnerId, cloud = false }: { ledgerKind: LedgerKind; ledgerName: string; onChanged: () => void; memoryRepository?: AssistantMemoryRepository; memoryOwnerId?: string; cloud?: boolean }) {
  const [defaultRepository] = useState(createAssistantMemoryRepository);
  const repository = memoryRepository ?? defaultRepository;
  const [state, setState] = useState<MemoryState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PreferenceRule | null>(null);
  const [clear, setClear] = useState(false);
  const [pending, setPending] = useState<{ backup: OwnerMemoryBackup; revisions: MemoryRevisions } | null>(null);
  useEffect(() => {
    let active = true;
    void (memoryOwnerId ? Promise.resolve(memoryOwnerId) : repository.getLocalOwnerId()).then(owner => repository.read(owner, ledgerKind)).then(value => { if (active) setState(value); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "记忆读取失败"); });
    return () => { active = false; };
  }, [repository, memoryOwnerId, ledgerKind]);
  async function mutate(action: () => Promise<MemoryState>, message: string) {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try { setState(await action()); setEditing(null); setClear(false); setNotice(message); onChanged(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "尚未保存，请重试"); return false; }
    finally { setBusy(false); }
  }
  async function reloadMemory() {
    if (busy) return;
    setBusy(true);
    try {
      const owner = memoryOwnerId ?? await repository.getLocalOwnerId();
      setState(await repository.read(owner, ledgerKind)); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "记忆暂时无法读取，请关闭面板后重试。"); }
    finally { setBusy(false); }
  }
  async function exportMemory() {
    if (!state) return;
    try {
      const backup = await repository.exportOwner(state.ownerId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `xiaoman-assistant-memory-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (e) { setError(e instanceof Error ? e.message : "记忆导出失败"); }
  }
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || !state) return;
    try {
      if (file.size > MAX_MEMORY_BACKUP_BYTES) throw Error("请选择不超过 7 MB 的助手记忆备份");
      const backup: unknown = JSON.parse(await file.text());
      if (!validateOwnerMemoryBackup(backup)) throw Error("这不是有效的助手记忆备份；账本备份请到数据与备份中导入。");
      const all = await repository.readOwner(state.ownerId);
      setPending({ backup, revisions: { personal: all.personal.revision, family: all.family.revision, travel: all.travel.revision } }); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "备份无法读取"); }
  }
  async function restore() {
    if (!state || !pending || busy) return;
    setBusy(true); setError("");
    try { const all = await repository.importOwner(state.ownerId, pending.backup, pending.revisions); setState(all[ledgerKind]); setPending(null); setNotice("三个账本近90天的对话与偏好已恢复，账目没有改变。"); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : "恢复失败，原内容已保留"); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault(); if (!state || !editing) return;
    void mutate(() => repository.upsertPreference(state.ownerId, ledgerKind, { ...editing, keyword: editing.keyword.trim() }, state.revision), "分类偏好已保存，仅影响以后生成的新草稿。");
  }
  return <section className="memory-panel" aria-label="助手记忆与偏好"><h2>记忆与偏好</h2><p className="helper">{ledgerName} · {cloud ? "当前账号的云端记忆" : "本机记忆，不自动上传"}</p>
    {!state && !error && <p role="status">正在读取记忆…</p>}
    {error && <p className="inline-error" role="alert">{error}<button disabled={busy} onClick={() => void reloadMemory()}>重新读取</button></p>}
    {notice && <p role="status">{notice}</p>}
    {state && <fieldset className="app-content" disabled={busy}>
      <details className="memory-companion"><summary>陪伴偏好</summary><CompanionPreferencesForm key={JSON.stringify(state.companion)} value={state.companion} today={localDate()} disabled={busy} onSave={value => mutate(() => repository.setCompanionPreferences(state.ownerId, ledgerKind, value, state.revision), "陪伴偏好已保存。")} /></details>
      <div className="memory-section"><h3>我记住的分类偏好</h3><p className="helper">只用于这个账本的新支出草稿。你本次说的要求优先，收入不受影响。</p>
        {state.preferences.length ? <ul className="preference-list">{state.preferences.map(rule => <li key={rule.id}><div><b>{rule.keyword}</b><span>{[rule.category, rule.nature].filter(Boolean).join(" · ")}</span></div><button aria-label={`修改偏好：${rule.keyword}`} onClick={() => setEditing({ ...rule })}>修改</button><button aria-label={`删除偏好：${rule.keyword}`} onClick={() => void mutate(() => repository.deletePreference(state.ownerId, ledgerKind, rule.id, state.revision), "偏好已删除，账目没有改变。")}>删除</button></li>)}</ul> : <p>还没有保存偏好。可以对小满说“以后健身课算投资”。</p>}
        {!editing && <button onClick={() => setEditing({ id: crypto.randomUUID(), keyword: "", category: null, nature: null })}>添加分类偏好</button>}
        {editing && <form className="preference-edit" onSubmit={save}><label>关键词（必填）<input autoComplete="off" minLength={2} maxLength={40} value={editing.keyword} onChange={e => setEditing({ ...editing, keyword: e.target.value })} placeholder="例如：健身课" required /></label><label>分类（选填）<select value={editing.category ?? ""} onChange={e => setEditing({ ...editing, category: (e.target.value || null) as PreferenceRule["category"] })}><option value="">沿用识别结果</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label><label>性质（选填）<select value={editing.nature ?? ""} onChange={e => setEditing({ ...editing, nature: (e.target.value || null) as PreferenceRule["nature"] })}><option value="">沿用识别结果</option><option>消费</option><option>浪费</option><option>投资</option></select></label><p className="helper">分类和性质至少选择一项。</p><div className="draft-actions"><button type="button" onClick={() => setEditing(null)}>取消修改</button><button className="primary" type="submit">保存偏好</button></div></form>}
      </div>
      <div className="memory-section"><h3>聊天记录</h3><p>已保存 {state.conversation.length} 条，聊天原文保留90天，到期自动清理。账目、确认过的分类习惯和陪伴偏好长期保留。</p>
        <p className="helper">{cloud ? "云端每小时检查，关闭网页也会清理。" : "本机在打开网页时清理；保持打开时每小时检查。"}</p>
        {clear ? <div className="memory-confirm"><p>清除{ledgerName}的对话与追问上下文？分类偏好和账目都会保留。</p><button onClick={() => setClear(false)}>保留对话</button><button onClick={() => void mutate(() => repository.clearConversation(state.ownerId, ledgerKind, state.revision), "本账本对话已清除，偏好与账目保留。")}>确认清除对话</button></div> : <button onClick={() => setClear(true)}>清除本账本对话</button>}
      </div>
      <details className="memory-backup"><summary>助手记忆备份</summary><p className="helper">包含三个账本的对话和偏好，不包含账目。换设备前请同时导出账本备份。</p><button onClick={() => void exportMemory()}>导出助手记忆</button><label className="memory-file">导入助手记忆<input type="file" accept=".json,application/json" onChange={event => void choose(event)} /></label>
        {pending && <div className="memory-confirm"><p>用备份替换三个账本的全部对话和偏好？账目不会改变，超过90天的对话不会恢复。建议先导出当前助手记忆。</p><button onClick={() => setPending(null)}>取消导入</button><button onClick={() => void restore()}>确认恢复助手记忆</button></div>}
      </details>
    </fieldset>}
  </section>;
}
