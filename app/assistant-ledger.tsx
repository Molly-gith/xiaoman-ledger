"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LedgerState, Transaction } from "../lib/domain/types";
import type { DateRange, DateRangeSummary } from "../lib/domain/date-range";
import type { TransactionDraft } from "../lib/ai/adapter";
import type { AssistantResult, ClarificationContext } from "../lib/ai/assistant-client";
import { converse } from "../lib/ai/conversation-client";
import type { ConversationResult, PreferenceProposal } from "../lib/ai/conversation-contract";
import { executeLedgerQuery, resolveLedgerQuery, type QueryPlan } from "../lib/domain/ledger-query";
import { applyPreferenceToDraft, parsePreferenceProposal } from "../lib/domain/assistant-preferences";
import { createAssistantMemoryRepository, type AssistantMemoryRepository, type ConversationMessage, type MemoryState } from "../lib/data/assistant-memory";
import { validateAssistantDraft } from "../lib/ai/assistant-contract";
import { VoiceInput } from "./voice-note";
import { LEDGER_KINDS, money } from "./ledger-components";
import { PeriodReviewPanel } from "./period-review";
import { buildPeriodReview, describePeriodReview } from "../lib/domain/period-review";
import { resolvePeriodReview } from "../lib/domain/period-review-intent";

type ReviewAnswer = { transactions: Transaction[]; range: DateRange; ledgerName: string };
type Draft = TransactionDraft & { id: string; preferenceReason?: string | null };
type Props = {
  endpoint: string; today: string; report: DateRangeSummary; revision: number; ledgerName: string; ledgerState: LedgerState;
  hidden: boolean; busy: boolean; suggestedPrompt: string;
  memoryRepository?: AssistantMemoryRepository; memoryOwnerId?: string; cloud?: boolean;
  onSave: (transactions: Transaction[]) => Promise<boolean>; onManual: () => void; onMemorySettings: () => void; readLedgerSnapshot: () => Promise<LedgerState>;
};
export function AssistantLedger({ endpoint, today, report, revision, ledgerName, ledgerState, hidden, busy, suggestedPrompt, onSave, onManual, onMemorySettings, readLedgerSnapshot, memoryRepository: providedMemory, memoryOwnerId, cloud = false }: Props) {
  const [defaultMemory] = useState(createAssistantMemoryRepository);
  const memoryRepository = providedMemory ?? defaultMemory;
  const [memory, setMemory] = useState<MemoryState | null>(null);
  const [memoryError, setMemoryError] = useState("");
  const [preference, setPreference] = useState<PreferenceProposal | null>(null);
  const [text, setText] = useState(suggestedPrompt);
  const [source, setSource] = useState<"text" | "voice">("text");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState<(Extract<AssistantResult, { status: "answer" }> & { revision: number; reportKey: string; query?: QueryPlan; review?: ReviewAnswer }) | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [clarification, setClarification] = useState<Omit<ClarificationContext, "answer"> | null>(null);
  const [lastText, setLastText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const latestRevision = useRef(revision);
  const memoryLatest = useRef<MemoryState | null>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const reportKey = JSON.stringify(report);
  const remember = (value: MemoryState) => { memoryLatest.current = value; setMemory(value); };

  useEffect(() => {
    let active = true;
    void (memoryOwnerId ? Promise.resolve(memoryOwnerId) : memoryRepository.getLocalOwnerId()).then(owner => memoryRepository.read(owner, ledgerState.ledgerKind)).then(value => {
      if (active) { memoryLatest.current = value; setMemory(value); setClarification(value.clarification); }
    }).catch(e => { if (active) setMemoryError(e instanceof Error ? e.message : "对话记忆读取失败，请重新载入。"); });
    return () => { active = false; };
  }, [memoryRepository, memoryOwnerId, ledgerState.ledgerKind]);
  useEffect(() => {
    const end = conversationEnd.current;
    if (end?.parentElement) end.parentElement.scrollTop = end.parentElement.scrollHeight;
  }, [memory?.revision]);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    latestRevision.current = revision;
    request.current?.abort(); request.current = null;
  }, [revision, reportKey, today]);
  useEffect(() => {
    if (!hidden) return;
    request.current?.abort(); request.current = null;
  }, [hidden]);
  useEffect(() => {
    if (suggestedPrompt) input.current?.focus();
  }, [suggestedPrompt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const original = text.trim();
    if (!original || request.current || busy || !memory || memoryError) return;
    const controller = new AbortController(); request.current = controller;
    controller.signal.addEventListener("abort", () => setWorking(false), { once: true });
    const requestedRevision = revision;
    setWorking(true); setMessage(""); setDrafts([]); setAnswer(null); setPreference(null); setEditing(null);
    try {
      const currentMemory = memoryLatest.current!;
      const previousQuery = [...currentMemory.conversation].reverse().find(m => m.query)?.query;
      const proposal = parsePreferenceProposal(original);
      const queryContext = { today, defaultRange: report.range, ledgerKind: ledgerState.ledgerKind, previousQuery };
      const reviewIntent = clarification ? { kind: "none" as const } : resolvePeriodReview(original, queryContext);
      const local = clarification ? { kind: "none" as const } : reviewIntent.kind === "none" ? resolveLedgerQuery(original, queryContext) : reviewIntent;
      let result: ConversationResult;
      if (proposal) result = { status: "preference", preference: { keyword: proposal.keyword, category: proposal.category, nature: proposal.nature } };
      else if (local.kind === "query" || local.kind === "review") result = { status: "query", plan: local.plan };
      else if (local.kind === "clarification") result = { status: "clarification", question: local.question };
      else if (!endpoint) result = { status: "unavailable", reason: "AI 暂时无法连接，文字已保留。常用日期查账和手动记账仍可使用。", originalText: original };
      else result = await converse({ endpoint, protocolVersion: 2, text: original, context: { today, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, ledgerKind: ledgerState.ledgerKind, defaultRange: report.range,
        memory: { recentMessages: currentMemory.conversation.slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 1000) })), ...(previousQuery ? { previousQuery } : {}) },
        ...(clarification ? { clarification: { ...clarification, answer: original } } : {}), signal: controller.signal });
      if (request.current !== controller || controller.signal.aborted || latestRevision.current !== requestedRevision) return;
      if (result.status === "unavailable") { setMessage(result.reason); return; }
      let responseText: string, query: QueryPlan | undefined, review: ReviewAnswer | undefined;
      let nextClarification: Omit<ClarificationContext, "answer"> | null = null;
      if (result.status === "query") {
        const snapshot = await readLedgerSnapshot();
        if (snapshot.ledgerKind !== ledgerState.ledgerKind) throw Error("账本已在另一个页面切换，请重新载入后再查询。文字已保留。");
        const computed = executeLedgerQuery(result.plan, snapshot); query = computed.plan; responseText = computed.answer;
        if (local.kind === "review") {
          const selectedBook = computed.ledgerKind === snapshot.ledgerKind ? snapshot : snapshot.otherLedgers[computed.ledgerKind];
          if (!selectedBook) throw Error("所选账本不存在，请重新选择。");
          const selectedName = LEDGER_KINDS.find(book => book.key === computed.ledgerKind)!.label;
          review = { transactions: selectedBook.transactions, range: computed.plan.range, ledgerName: selectedName };
          responseText = describePeriodReview(buildPeriodReview(review.transactions, review.range, today), selectedName);
        }
      }
      else if (result.status === "transactions") responseText = `整理了 ${result.drafts.length} 笔待确认账目，尚未保存。`;
      else if (result.status === "preference") responseText = `建议记住：“${result.preference.keyword}”${result.preference.category ? `分类为${result.preference.category}` : ""}${result.preference.nature ? `算${result.preference.nature}` : ""}。等你确认后生效。`;
      else if (result.status === "clarification") {
        responseText = result.question;
        nextClarification = { originalText: (clarification ? `${clarification.originalText}\n补充：${original}` : original).slice(0, 2000), question: result.question };
      } else responseText = result.answer;
      const messages: ConversationMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: original, createdAt: new Date().toISOString() },
        { id: crypto.randomUUID(), role: "assistant", content: responseText.slice(0, 2000), createdAt: new Date().toISOString(), ...(query ? { query } : {}) },
      ];
      if (request.current !== controller || controller.signal.aborted || latestRevision.current !== requestedRevision) return;
      const nextMemory = await memoryRepository.appendConversation(currentMemory.ownerId, ledgerState.ledgerKind, messages, currentMemory.revision, nextClarification);
      if (request.current !== controller || controller.signal.aborted || latestRevision.current !== requestedRevision) return;
      remember(nextMemory); setLastText(original); setText(""); setClarification(nextClarification);
      if (result.status === "transactions") setDrafts(result.drafts.map(draft => { const applied = applyPreferenceToDraft(draft, nextMemory.preferences, `${clarification?.originalText ?? ""}\n${original}`); return { ...applied.draft, id: crypto.randomUUID(), preferenceReason: applied.reason }; }));
      else if (result.status === "preference") setPreference(result.preference);
      else if (result.status === "answer" || result.status === "query") setAnswer({ status: "answer", answer: responseText, nextActions: [], revision: requestedRevision, reportKey, query, review });
      input.current?.focus();
    } catch (e) { setMessage(e instanceof Error ? e.message : "这次没有处理成功，输入已保留。"); }
    finally { if (request.current === controller) { request.current = null; setWorking(false); } }
  }
  async function confirmPreference() {
    const current = memoryLatest.current;
    if (!current || !preference || saving.current) return;
    saving.current = true;
    try {
      const old = current.preferences.find(p => p.keyword.normalize("NFKC").toLowerCase() === preference.keyword.normalize("NFKC").toLowerCase());
      const next = await memoryRepository.upsertPreference(current.ownerId, ledgerState.ledgerKind, { ...preference, category: preference.category as MemoryState["preferences"][number]["category"], id: old?.id ?? crypto.randomUUID() }, current.revision);
      remember(next); setPreference(null); setMessage("");
      const saved = await memoryRepository.appendConversation(next.ownerId, ledgerState.ledgerKind, [{ id: crypto.randomUUID(), role: "assistant", content: `已记住“${preference.keyword}”的分类偏好，仅用于${ledgerName}的新草稿。已有账目不会改变。`, createdAt: new Date().toISOString() }], next.revision);
      remember(saved);
    } catch (e) { setMessage(e instanceof Error ? e.message : "偏好尚未保存，请重试。"); }
    finally { saving.current = false; }
  }
  async function save() {
    if (saving.current || busy || !drafts.length) return;
    if (!drafts.every(({ id, preferenceReason, ...draft }) => { void preferenceReason; return !!id && validateAssistantDraft(draft, today); })) { setMessage("请检查金额、分类和日期，金额须大于零，日期不能晚于今天。"); return; }
    saving.current = true; setMessage("");
    try {
      const saved = await onSave(drafts.map(draft => ({ id: draft.id, type: draft.type, amount: draft.amount, date: draft.occurred_at,
        category: draft.category.trim(), note: draft.note.trim() || draft.category.trim(), icon: "记", source,
        cycleId: null, nature: draft.type === "income" ? null : draft.nature_suggestion ?? "消费", spendKind: draft.type === "income" ? null : "variable" })));
      if (saved) {
        setDrafts([]); setText(""); setEditing(null); setLastText("");
        const current = memoryLatest.current;
        if (current) try { remember(await memoryRepository.appendConversation(current.ownerId, ledgerState.ledgerKind, [{ id: crypto.randomUUID(), role: "assistant", content: `用户已确认，${drafts.length} 笔账目已保存到${ledgerName}。`, createdAt: new Date().toISOString() }], current.revision)); }
        catch { setMessage("账目已经保存，但这条保存回执未能写入对话记忆。请勿重复记账。"); }
      }
    } finally { saving.current = false; }
  }
  const updateDraft = (id: string, patch: Partial<Draft>) => setDrafts(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const reset = () => {
    setDrafts([]); setAnswer(null); setPreference(null); setClarification(null); setMessage(""); setText(""); setLastText(""); input.current?.focus();
    const current = memoryLatest.current;
    if (current?.clarification) void memoryRepository.replaceConversation(current.ownerId, ledgerState.ledgerKind, current.conversation, current.revision, null).then(remember).catch(e => setMessage(e instanceof Error ? e.message : "补问记忆未能清除，请重试。"));
  };

  return <section className="ledger-assistant" aria-label="与小满对话">
    <div className="assistant-heading"><h2>说一句，记账、查账都可以。</h2><p>正在使用{ledgerName} · 可以接着上次的话聊</p></div>
    {memoryError && <p role="alert" className="inline-error">{memoryError}<button onClick={() => window.location.reload()}>重新载入</button></p>}
    <form className="natural-composer" onSubmit={event => void submit(event)}>
      <label className="sr-only" htmlFor="assistant-question">记账或问小满</label>
      <textarea ref={input} id="assistant-question" placeholder={clarification ? "补充这条信息就好…" : "比如：今天午饭35元，工资到账8000元"} value={text} onChange={event => { setText(event.target.value); setSource("text"); }} maxLength={1000} rows={3} disabled={working || busy} />
      <div className="composer-tools"><VoiceInput disabled={hidden || working || busy} onResult={value => { setText(current => current ? `${current} ${value}` : value); setSource("voice"); input.current?.focus(); }} /><div>{working ? <button key="cancel-request" type="button" onClick={event => { event.preventDefault(); request.current?.abort(); request.current = null; setWorking(false); setMessage("已取消，文字保留。 "); }}>取消</button> : <button key="send-request" className="primary" type="submit" aria-label="发送给小满" disabled={!text.trim() || busy || !memory || !!memoryError}>发送</button>}</div></div>
    </form>
    <div className="composer-foot"><button data-testid="home-action-add" onClick={onManual}>手动记一笔</button><button onClick={onMemorySettings}>记忆与偏好</button><details><summary>数据怎么使用</summary><p>常用查账由程序计算。需要模型理解时，本次文字、当前账本最近八条对话和查询条件会交给 Dify 与模型；不自动发送全部逐笔账目。语音由浏览器识别成文字。{cloud ? "当前账目、最近四十条对话和偏好保存在这个账号的云端，需要联网读取和保存。" : "当前账目、最近四十条对话和偏好保存在本机，登录不会自动上传旧账。"}</p></details></div>
    <div className="assistant-result" aria-live="polite" aria-busy={working}>
      {working && <p className="thinking" role="status">小满正在整理…</p>}
      {message && <p className="inline-error" role="alert">{message}</p>}
      {clarification && <div className="clarification"><p>{clarification.question}</p><button onClick={reset}>重新说一笔</button></div>}
      {preference && <section className="preference-proposal" aria-label="待确认分类偏好"><h3>以后这样帮你分</h3><p>“{preference.keyword}”{preference.category ? ` · ${preference.category}` : ""}{preference.nature ? ` · ${preference.nature}` : ""}</p><p className="helper">仅用于{ledgerName}的新草稿，不改变已有账目。随时可在「记忆与偏好」修改或删除。</p><div className="draft-actions"><button onClick={() => setPreference(null)}>先不记住</button><button className="primary" onClick={() => void confirmPreference()}>确认记住</button></div></section>}
      {drafts.length > 0 && <section className="draft-preview" aria-label="待保存账目"><div className="section-title"><h3>整理好了，看看对不对</h3><span>{drafts.length} 笔 · 尚未保存</span></div><p className="draft-destination">将记入{ledgerName}</p>
        {drafts.map((draft, index) => <article key={draft.id} className="draft-row">
          <div className="draft-summary"><div><b>{draft.note || draft.category}</b><small>{draft.type === "income" ? "收入" : `支出 · ${draft.nature_suggestion ?? "消费"}`} · {draft.category} · {draft.occurred_at === today ? "今天" : draft.occurred_at}</small></div><strong className={draft.type}>{draft.type === "income" ? "+" : "−"}{money(draft.amount)}</strong><button aria-label={`修改第${index + 1}笔`} onClick={() => setEditing(current => current === draft.id ? null : draft.id)}>{editing === draft.id ? "收起" : "修改"}</button></div>
          {draft.preferenceReason && <p className="preference-reason">{draft.preferenceReason}</p>}
          {editing === draft.id && <div className="draft-fields">
            <label>收支类型<select value={draft.type} onChange={event => updateDraft(draft.id, { type: event.target.value as Draft["type"], nature_suggestion: event.target.value === "income" ? null : "消费", category: event.target.value === "income" ? "收入" : "其他" })}><option value="expense">支出</option><option value="income">收入</option></select></label>
            <label>金额（必填）<input type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.amount || ""} onChange={e => updateDraft(draft.id, { amount: Number(e.target.value) })} /></label>
            {draft.type === "expense" && <label>性质<select value={draft.nature_suggestion ?? "消费"} onChange={e => updateDraft(draft.id, { nature_suggestion: e.target.value as Draft["nature_suggestion"] })}><option>消费</option><option>浪费</option><option>投资</option></select></label>}
            <label>分类<select value={draft.category} onChange={e => updateDraft(draft.id, { category: e.target.value })}>{(draft.type === "income" ? ["收入"] : ["餐饮", "购物", "交通", "居住", "健康", "医疗", "学习", "娱乐", "其他"]).map(category => <option key={category}>{category}</option>)}</select></label>
            <label>日期<input type="date" max={today} value={draft.occurred_at} onChange={e => updateDraft(draft.id, { occurred_at: e.target.value })} /></label>
            <label>备注（选填）<input value={draft.note} maxLength={100} onChange={e => updateDraft(draft.id, { note: e.target.value })} /></label>
          </div>}
        </article>)}
        <div className="draft-actions"><button onClick={reset}>不保存</button><button className="primary" onClick={() => void save()} disabled={busy}>{busy ? "保存中…" : drafts.length === 1 ? "保存这笔" : `保存这 ${drafts.length} 笔`}</button></div>
      </section>}
      {answer && answer.revision === revision && answer.reportKey === reportKey && <section className="answer-copy" data-testid="ai-answer"><p className="ai-question">{lastText}</p><p className="ai-answer-text">{answer.review ? "已根据账目整理好这段时间的复盘，可以展开每项依据核对。" : answer.answer}</p>{answer.review && <PeriodReviewPanel key={`${answer.revision}:${answer.review.ledgerName}:${answer.review.range.startDate}:${answer.review.range.endDate}`} {...answer.review} today={today} defaultOpen />}<p className="helper">{answer.query ? `金额由${cloud ? "当前账目" : "本机账目"}计算。可以接着问，也可以到「账单」核对。` : "小满的使用说明；没有修改账目。"}</p></section>}
    </div>
    {!!memory?.conversation.length && <details className="conversation-history" open={!answer && !drafts.length && !preference && !clarification}><summary>对话记录 · {ledgerName} <span>{memory.conversation.length} 条</span></summary><p className="helper">以下为当时的回答；账目变动后可重新询问。最近四十条保存在{cloud ? "当前账号的云端" : "本机"}。</p><div className="conversation-log" role="log" aria-label={`${ledgerName}对话记录`}>{memory.conversation.map(m => <article key={m.id} className={`conversation-message ${m.role}`}><small>{m.role === "user" ? "我" : "小满"} · {new Date(m.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small><p>{m.content}</p></article>)}<div ref={conversationEnd} /></div></details>}
  </section>;
}
