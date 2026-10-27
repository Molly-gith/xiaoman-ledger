"use client";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { LedgerState, Transaction } from "../lib/domain/types";
import type { DateRange, DateRangeSummary } from "../lib/domain/date-range";
import type { TransactionDraft } from "../lib/ai/adapter";
import type { AssistantResult, ClarificationContext } from "../lib/ai/assistant-client";
import { converse } from "../lib/ai/conversation-client";
import type { ConversationResult, PreferenceProposal } from "../lib/ai/conversation-contract";
import { executeLedgerQuery, resolveLedgerQuery, type QueryPlan } from "../lib/domain/ledger-query";
import { applyPreferenceToDraft, parsePreferenceProposal } from "../lib/domain/assistant-preferences";
import { createAssistantMemoryRepository, type AssistantMemoryRepository, type ConversationMessage, type MemoryState, type CompanionPreferences } from "../lib/data/assistant-memory";
import { validateAssistantDraft } from "../lib/ai/assistant-contract";
import { VoiceInput } from "./voice-note";
import { StoryIcon } from "./story-icons";
import { LEDGER_KINDS, money } from "./ledger-components";
import { PeriodReviewPanel } from "./period-review";
import { buildPeriodReview, describePeriodReview } from "../lib/domain/period-review";
import { resolvePeriodReview } from "../lib/domain/period-review-intent";
import { buildCompanionContext, getCompanionReminders } from "../lib/domain/companion-context";
import { CompanionPreferencesForm } from "./companion-preferences";
import "./assistant-chat.css";

function messageDay(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

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
  const [answer, setAnswer] = useState<(Extract<AssistantResult, { status: "answer" }> & { id: string; revision: number; reportKey: string; query?: QueryPlan; review?: ReviewAnswer }) | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [clarification, setClarification] = useState<Omit<ClarificationContext, "answer"> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftMessageId, setDraftMessageId] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<"text" | "voice">("text");
  const [preferenceMessageId, setPreferenceMessageId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(20);
  const [historyDate, setHistoryDate] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const memoryWriting = useRef(false);
  const reminderRevision = useRef("");
  const live = useRef(true);
  const assistantRoot = useRef<HTMLElement>(null);
  const preferencesDetails = useRef<HTMLDetailsElement>(null);
  const conversationLog = useRef<HTMLDivElement>(null);
  const scrollRestore = useRef<{ height: number; top: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const latestRevision = useRef(revision);
  const memoryLatest = useRef<MemoryState | null>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const reportKey = JSON.stringify(report);
  const remember = useCallback((value: MemoryState) => { memoryLatest.current = value; setMemory(value); }, []);

  useEffect(() => {
    let active = true;
    void (memoryOwnerId ? Promise.resolve(memoryOwnerId) : memoryRepository.getLocalOwnerId()).then(owner => memoryRepository.read(owner, ledgerState.ledgerKind)).then(value => {
      if (active) { memoryLatest.current = value; setMemory(value); setClarification(value.clarification); }
    }).catch(e => { if (active) setMemoryError(e instanceof Error ? e.message : "对话记忆读取失败，请重新载入。"); });
    return () => { active = false; };
  }, [memoryRepository, memoryOwnerId, ledgerState.ledgerKind]);
  useLayoutEffect(() => {
    const element = conversationLog.current;
    if (!element) return;
    const before = scrollRestore.current;
    if (before) { element.scrollTop = element.scrollHeight - before.height + before.top; scrollRestore.current = null; }
    else element.scrollTop = historyDate ? 0 : element.scrollHeight;
  }, [memory?.conversation.length, visibleCount, historyDate]);

  useEffect(() => {
    live.current = true;
    const resize = () => {
      assistantRoot.current?.style.setProperty("--assistant-viewport-height", (window.visualViewport?.height ?? window.innerHeight) + "px");
      if (document.activeElement === input.current) input.current?.scrollIntoView({ block: "nearest" });
    };
    resize(); window.visualViewport?.addEventListener("resize", resize);
    return () => { live.current = false; request.current?.abort(); window.visualViewport?.removeEventListener("resize", resize); };
  }, []);

  useEffect(() => {
    if (!memory || hidden || busy || working || request.current || saving.current || memoryWriting.current) return;
    const gate = `${ledgerState.ledgerKind}:${ledgerState.revision}:${today}`;
    if (reminderRevision.current === gate) return;
    let reminder;
    try { reminder = getCompanionReminders(buildCompanionContext(ledgerState, today, memory.companion)).find(candidate => !memory.conversation.some(item => item.reminderId === candidate.id)); }
    catch { return; }
    if (!reminder) return;
    reminderRevision.current = gate;
    memoryWriting.current = true;
    void Promise.resolve().then(() => { if (!live.current) throw Error("View changed"); setMemoryBusy(true); return memoryRepository.appendConversation(memory.ownerId, ledgerState.ledgerKind, [{
      id: crypto.randomUUID(), role: "assistant", content: reminder.text, createdAt: new Date().toISOString(), reminderId: reminder.id,
    }], memory.revision); }).then(next => { if (live.current) remember(next); })
      .catch(() => { /* Optional reminders never block bookkeeping or retry in a loop. */ })
      .finally(() => { memoryWriting.current = false; if (live.current) setMemoryBusy(false); });
  }, [memory, ledgerState, today, hidden, busy, working, memoryRepository, remember]);

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
    if (!original || request.current || busy || saving.current || memoryWriting.current || !memory || memoryError) return;
    const controller = new AbortController(); request.current = controller;
    controller.signal.addEventListener("abort", () => setWorking(false), { once: true });
    const requestedRevision = revision;
    setWorking(true); setMessage(""); setNotice(""); setAnswer(null); setHistoryDate(""); setVisibleCount(20);
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
      else {
        const snapshot = await readLedgerSnapshot();
        if (snapshot.ledgerKind !== ledgerState.ledgerKind) throw Error("账本已在另一个页面切换，请重新载入。文字已保留。");
        let companion;
        try { companion = buildCompanionContext(snapshot, today, currentMemory.companion); } catch { /* Optional advice must not break ordinary bookkeeping. */ }
        if (request.current !== controller || controller.signal.aborted) return;
        result = await converse({ endpoint, protocolVersion: 2, text: original, context: { today, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, ledgerKind: ledgerState.ledgerKind, defaultRange: report.range,
        memory: { recentMessages: currentMemory.conversation.slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 1000) })), ...(previousQuery ? { previousQuery } : {}) },
        ...(companion ? { companion } : {}),
        ...(clarification ? { clarification: { ...clarification, answer: original } } : {}), signal: controller.signal });
      }
      if (request.current !== controller || controller.signal.aborted || latestRevision.current !== requestedRevision) return;
      if (result.status === "unavailable") { setMessage(result.reason); return; }
      if (result.status === "transactions" && drafts.length) { setMessage("还有待确认账目，请先保存或取消，再发送这句话。文字已保留。"); return; }
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
      remember(nextMemory); setText(""); setClarification(nextClarification);
      if (result.status === "transactions") { setDraftMessageId(messages[1].id); setDraftSource(source); setDrafts(result.drafts.map(draft => { const applied = applyPreferenceToDraft(draft, nextMemory.preferences, `${clarification?.originalText ?? ""}\n${original}`); return { ...applied.draft, id: crypto.randomUUID(), preferenceReason: applied.reason }; })); }
      else if (result.status === "preference") { setPreference(result.preference); setPreferenceMessageId(messages[1].id); }
      else if (result.status === "answer" || result.status === "query") setAnswer({ id: messages[1].id, status: "answer", answer: responseText, nextActions: [], revision: requestedRevision, reportKey, query, review });
      input.current?.focus();
    } catch (e) { setMessage(e instanceof Error ? e.message : "这次没有处理成功，输入已保留。"); }
    finally { if (request.current === controller) { request.current = null; setWorking(false); } }
  }
  async function confirmPreference() {
    const current = memoryLatest.current;
    if (!current || !preference || saving.current || memoryWriting.current || request.current) return;
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
    if (saving.current || busy || memoryWriting.current || request.current || !drafts.length) return;
    if (!drafts.every(({ id, preferenceReason, ...draft }) => { void preferenceReason; return !!id && validateAssistantDraft(draft, today); })) { setMessage("请检查金额、分类和日期，金额须大于零，日期不能晚于今天。"); return; }
    saving.current = true; setMessage(""); setNotice("");
    const savedDrafts = drafts;
    try {
      const saved = await onSave(savedDrafts.map(draft => ({ id: draft.id, type: draft.type, amount: draft.amount, date: draft.occurred_at,
        category: draft.category.trim(), note: draft.note.trim() || draft.category.trim(), icon: "记", source: draftSource,
        cycleId: null, nature: draft.type === "income" ? null : draft.nature_suggestion ?? "消费", spendKind: draft.type === "income" ? null : "variable" })));
      if (saved && live.current) {
        setDrafts([]); setDraftMessageId(null); setEditing(null); setMemoryBusy(true);
        const current = memoryLatest.current;
        if (current) try {
          const receipt: ConversationMessage = { id: crypto.randomUUID(), role: "assistant", content: `已确认，${savedDrafts.length} 笔账目已保存到${ledgerName}：${savedDrafts.map(draft => `${draft.note || draft.category} ${money(draft.amount)}`).join("、")}。`, createdAt: new Date().toISOString(), ...(draftMessageId ? { replyTo: draftMessageId } : {}) };
          const messages = [receipt];
          try {
            const snapshot = await readLedgerSnapshot();
            if (snapshot.ledgerKind === ledgerState.ledgerKind) {
              const reminder = getCompanionReminders(buildCompanionContext(snapshot, today, current.companion)).find(candidate => !current.conversation.some(item => item.reminderId === candidate.id));
              reminderRevision.current = `${snapshot.ledgerKind}:${snapshot.revision}:${today}`;
              if (reminder) messages.push({ id: crypto.randomUUID(), role: "assistant", content: reminder.text, createdAt: new Date().toISOString(), reminderId: reminder.id, replyTo: receipt.id });
            }
          } catch { /* The confirmed receipt remains valid even if an optional reread fails. */ }
          const next = await memoryRepository.appendConversation(current.ownerId, ledgerState.ledgerKind, messages, current.revision);
          if (live.current) remember(next);
        } catch { if (live.current) setMessage("账目已经保存，但保存回执未能写入对话。请勿重复记账。"); }
      }
    } finally { saving.current = false; if (live.current) setMemoryBusy(false); }
  }
  function suggest(value: string) { setText(value); setSource("text"); input.current?.focus(); }
  async function saveCompanion(value: CompanionPreferences): Promise<boolean> {
    const current = memoryLatest.current;
    if (!current || memoryWriting.current || saving.current || request.current) return false;
    memoryWriting.current = true; setMemoryBusy(true); setMessage(""); setNotice("");
    try {
      const next = await memoryRepository.setCompanionPreferences(current.ownerId, ledgerState.ledgerKind, value, current.revision);
      if (!live.current) return false;
      remember(next); setNotice(value.mutedUntil === today ? "今天安静陪你，记账和查账照常。" : "陪伴偏好已保存。");
      if (preferencesDetails.current) preferencesDetails.current.open = false;
      return true;
    } catch (problem) { if (live.current) setMessage(problem instanceof Error ? problem.message : "陪伴偏好未保存，请重试。"); return false; }
    finally { memoryWriting.current = false; if (live.current) setMemoryBusy(false); }
  }
  const updateDraft = (id: string, patch: Partial<Draft>) => setDrafts(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  async function reset() {
    const current = memoryLatest.current;
    if (!current || saving.current || memoryWriting.current || request.current) return;
    memoryWriting.current = true; setMemoryBusy(true); setMessage("");
    try {
      const receipt: ConversationMessage = { id: crypto.randomUUID(), role: "assistant", content: drafts.length ? "这次草稿已取消，没有保存账目。" : "这次补问已结束，可以重新说。", createdAt: new Date().toISOString(), ...(draftMessageId ? { replyTo: draftMessageId } : {}) };
      const next = await memoryRepository.appendConversation(current.ownerId, ledgerState.ledgerKind, [receipt], current.revision, null);
      if (!live.current) return;
      remember(next); setDrafts([]); setDraftMessageId(null); setAnswer(null); setPreference(null); setClarification(null); setEditing(null);
      input.current?.focus();
    } catch (problem) { setMessage(problem instanceof Error ? problem.message : "尚未取消，请重试。"); }
    finally { memoryWriting.current = false; if (live.current) setMemoryBusy(false); }
  }

  const allMessages = memory?.conversation ?? [];
  const chatToday = messageDay(new Date().toISOString());
  const matching = historyDate ? allMessages.filter(item => messageDay(item.createdAt) === historyDate) : allMessages;
  const visibleMessages = matching.slice(-visibleCount);
  const latestAssistantId = [...allMessages].reverse().find(item => item.role === "assistant")?.id;
  const clarificationId = clarification ? latestAssistantId : null;
  const currentAnswer = answer?.revision === revision && answer.reportKey === reportKey ? answer : null;
  return <section ref={assistantRoot} className="ledger-assistant companion-chat" aria-label="与小满对话">
    <div className="chat-toolbar"><div><h2>和小满聊聊</h2><p>{ledgerName} · 只根据你记下的账目</p></div><details className="companion-settings" ref={preferencesDetails}><summary>陪伴偏好</summary>{memory && <CompanionPreferencesForm key={JSON.stringify(memory.companion)} value={memory.companion} today={today} disabled={busy || working || memoryBusy} onSave={saveCompanion} />}</details></div>
    {memoryError && <p role="alert" className="inline-error">{memoryError}<button onClick={() => window.location.reload()}>重新载入</button></p>}
    {!!allMessages.length && <div className="chat-history-tools"><details><summary>按日期找对话</summary><label>对话日期（北京时间）<input type="date" value={historyDate} max={chatToday} onChange={event => { setHistoryDate(event.target.value); setVisibleCount(20); }} /></label></details>{historyDate ? <button onClick={() => { setHistoryDate(""); setVisibleCount(20); }}>回到最新</button> : <span>{allMessages.length} 条已保存</span>}</div>}
    <div ref={conversationLog} className={`conversation-log chat-thread${allMessages.length || working ? "" : " is-empty"}`} role="log" aria-label={`${ledgerName}对话记录`} aria-live="polite" aria-relevant="additions" aria-busy={working}>
      {matching.length > visibleCount && <button className="chat-load-more" onClick={() => { const element = conversationLog.current; if (element) scrollRestore.current = { height: element.scrollHeight, top: element.scrollTop }; setVisibleCount(count => count + 20); }}>加载更早的对话</button>}
      {!allMessages.length && <div className="chat-welcome"><p>今天，想记点什么？</p><small>说一笔花费，或聊聊今天。小满听着。</small><div><button onClick={() => suggest("本月支出多少？")}><StoryIcon name="book" />看看本月花费</button><button onClick={() => suggest("帮我复盘这个月")}><StoryIcon name="leaf" />一起复盘</button></div></div>}
      {historyDate && !matching.length && <p className="chat-empty">这一天还没有保存的对话。</p>}
      {visibleMessages.map((item, index) => {
        const isAnswer = currentAnswer?.id === item.id;
        const liveDraft = draftMessageId === item.id && drafts.length > 0;
        const hasPreference = preference && preferenceMessageId === item.id;
        const day = messageDay(item.createdAt);
        return <Fragment key={item.id}>
          {(!index || messageDay(visibleMessages[index - 1].createdAt) !== day) && <p className="chat-day"><time dateTime={day}>{day === chatToday ? "今天" : day}</time></p>}
          <article className={`conversation-message ${item.role}${liveDraft || hasPreference || (isAnswer && currentAnswer.review) ? " has-action" : ""}`} data-message-id={item.id} data-testid={isAnswer ? "ai-answer" : undefined}>
            <small>{item.role === "user" ? "我" : item.reminderId ? "小满 · 提醒" : "小满"} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit" })}</time></small>
            {item.id !== clarificationId && <p>{item.content}</p>}
            {item.replyTo && <button className="chat-related" onClick={() => { setHistoryDate(""); setVisibleCount(allMessages.length); requestAnimationFrame(() => { const related = Array.from(conversationLog.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []).find(element => element.dataset.messageId === item.replyTo); related?.scrollIntoView({ block: "nearest" }); }); }}>查看对应消息</button>}
            {item.query && <p className="chat-fact-note">金额由{cloud ? "当前账目" : "本机账目"}计算；这是当时的回答。</p>}
            {isAnswer && currentAnswer.review && <PeriodReviewPanel key={`${currentAnswer.revision}:${item.id}`} {...currentAnswer.review} today={today} defaultOpen />}
            {item.id === clarificationId && <div className="clarification"><p>{clarification?.question}</p><button disabled={working || memoryBusy} onClick={() => void reset()}>重新说一笔</button></div>}
            {hasPreference && <section className="preference-proposal" aria-label="待确认分类偏好"><h3>以后这样帮你分</h3><p>“{preference.keyword}”{preference.category ? ` · ${preference.category}` : ""}{preference.nature ? ` · ${preference.nature}` : ""}</p><p className="helper">仅用于{ledgerName}的新草稿，不改变已有账目。</p><div className="draft-actions"><button disabled={working || memoryBusy} onClick={() => setPreference(null)}>先不记住</button><button className="primary" disabled={working || memoryBusy} onClick={() => void confirmPreference()}>确认记住</button></div></section>}
            {liveDraft && <section className="draft-preview" aria-label="待保存账目"><div className="section-title"><h3>整理好了，看看对不对</h3><span>{drafts.length} 笔 · 尚未保存</span></div><p className="draft-destination">将记入{ledgerName}</p>
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
        <div className="draft-actions"><button disabled={busy || working || memoryBusy} onClick={() => void reset()}>不保存</button><button className="primary" onClick={() => void save()} disabled={busy || working || memoryBusy}>{busy ? "保存中…" : drafts.length === 1 ? "保存这笔" : `保存这 ${drafts.length} 笔`}</button></div>
      </section>}
            {item.reminderId && item.id === latestAssistantId && memory && memory.companion.mutedUntil !== today && <button className="chat-quiet" disabled={working || memoryBusy || busy} onClick={() => void saveCompanion({ ...memory.companion, mutedUntil: today })}>今天少唠叨</button>}
          </article>
        </Fragment>;
      })}
      {working && <><article className="conversation-message user pending"><small>我 · 正在发送</small><p>{text}</p></article><p className="thinking" role="status">小满正在想…</p></>}
      <div ref={conversationEnd} />
    </div>
    <div className="chat-composer-area">
      {message && <p className="inline-error" role="alert">{message}</p>}
      {notice && <p className="chat-notice" role="status">{notice}</p>}
      {!!drafts.length && !visibleMessages.some(item => item.id === draftMessageId) && <button className="chat-pending-link" onClick={() => { setHistoryDate(""); setVisibleCount(allMessages.length); }}>回到待确认账目</button>}
      <form className="natural-composer" onSubmit={event => void submit(event)}>
        <label className="sr-only" htmlFor="assistant-question">记账或问小满</label>
        <textarea ref={input} id="assistant-question" placeholder={clarification ? "补充这条信息就好…" : allMessages.length ? "记一笔，或接着聊聊…" : "比如：今天午饭35元"} value={text} onChange={event => { setText(event.target.value); setSource("text"); }} maxLength={1000} rows={2} disabled={working || busy} />
        <div className="composer-tools"><div className="composer-input-tools"><VoiceInput disabled={hidden || working || busy} onResult={value => { setText(current => current ? `${current} ${value}` : value); setSource("voice"); input.current?.focus(); }} /><button type="button" data-testid="home-action-add" disabled={working || busy} onClick={onManual}><StoryIcon name="plus" />手动记一笔</button></div><div>{working ? <button key="cancel-request" type="button" onClick={event => { event.preventDefault(); request.current?.abort(); request.current = null; setWorking(false); setMessage("已取消，文字保留。"); }}>取消</button> : <button key="send-request" className="primary" type="submit" aria-label="发送给小满" disabled={!text.trim() || busy || memoryBusy || !memory || !!memoryError}>发送</button>}</div></div>
      </form>
      <div className="composer-foot"><button onClick={onMemorySettings}>记忆与偏好</button><details><summary>数据怎么使用</summary><p>对话保存在{cloud ? "当前账号的云端" : "本机"}，可翻阅历史。模型只接收最近八条对话、当前文字及必要的账目汇总和陪伴偏好，不自动发送全部逐笔账目。语音由浏览器转成文字。提醒仅在页面内显示。</p></details></div>
    </div>
  </section>;
}
