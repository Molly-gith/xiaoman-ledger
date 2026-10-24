"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Transaction } from "../lib/domain/types";
import type { DateRangeSummary } from "../lib/domain/date-range";
import type { TransactionDraft } from "../lib/ai/adapter";
import { assistLedger, type AssistantResult, type ClarificationContext } from "../lib/ai/assistant-client";
import { validateAssistantDraft } from "../lib/ai/assistant-contract";
import { VoiceInput } from "./voice-note";
import { money } from "./ledger-components";

type Draft = TransactionDraft & { id: string };
type Props = {
  endpoint: string; today: string; report: DateRangeSummary; revision: number;
  hidden: boolean; busy: boolean; suggestedPrompt: string;
  onSave: (transactions: Transaction[]) => Promise<boolean>; onManual: () => void;
};
export function AssistantLedger({ endpoint, today, report, revision, hidden, busy, suggestedPrompt, onSave, onManual }: Props) {
  const [text, setText] = useState(suggestedPrompt);
  const [source, setSource] = useState<"text" | "voice">("text");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState<(Extract<AssistantResult, { status: "answer" }> & { revision: number; reportKey: string }) | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [clarification, setClarification] = useState<Omit<ClarificationContext, "answer"> | null>(null);
  const [lastText, setLastText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const latestRevision = useRef(revision);
  const reportKey = JSON.stringify(report);

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
    if (!original || request.current || busy) return;
    if (!endpoint) { setMessage("AI 暂时无法连接，文字会保留。你也可以先手动记账。"); return; }
    const controller = new AbortController(); request.current = controller;
    controller.signal.addEventListener("abort", () => setWorking(false), { once: true });
    const requestedRevision = revision;
    setWorking(true); setMessage(""); setDrafts([]); setAnswer(null); setEditing(null);
    const result = await assistLedger({ endpoint, text: original, context: { today, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, report,
      ...(clarification ? { clarification: { ...clarification, answer: original } } : {}), signal: controller.signal });
    if (request.current !== controller || controller.signal.aborted || latestRevision.current !== requestedRevision) return;
    request.current = null; setWorking(false); setLastText(original);
    if (result.status === "unavailable") { setMessage(result.reason); return; }
    if (result.status === "clarification") {
      const prior = clarification ? `${clarification.originalText}\n补充：${original}` : original;
      setClarification({ originalText: prior.slice(0, 2000), question: result.question });
      setText(""); input.current?.focus(); return;
    }
    setClarification(null);
    if (result.status === "transactions") setDrafts(result.drafts.map(draft => ({ ...draft, id: crypto.randomUUID() })));
    else setAnswer({ ...result, revision: requestedRevision, reportKey });
  }
  async function save() {
    if (saving.current || busy || !drafts.length) return;
    if (!drafts.every(({ id, ...draft }) => !!id && validateAssistantDraft(draft, today))) { setMessage("请检查金额、分类和日期，金额须大于零，日期不能晚于今天。"); return; }
    saving.current = true; setMessage("");
    try {
      const saved = await onSave(drafts.map(draft => ({ id: draft.id, type: draft.type, amount: draft.amount, date: draft.occurred_at,
        category: draft.category.trim(), note: draft.note.trim() || draft.category.trim(), icon: "记", source,
        cycleId: null, nature: draft.type === "income" ? null : draft.nature_suggestion ?? "消费", spendKind: draft.type === "income" ? null : "variable" })));
      if (saved) { setDrafts([]); setText(""); setEditing(null); setLastText(""); }
    } finally { saving.current = false; }
  }
  const updateDraft = (id: string, patch: Partial<Draft>) => setDrafts(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const reset = () => { setDrafts([]); setAnswer(null); setClarification(null); setMessage(""); setText(""); setLastText(""); input.current?.focus(); };

  return <section className="ledger-assistant" aria-label="与小满对话">
    <div className="assistant-heading"><h2>说一句，小满帮你记。</h2><p>收入、花费，也可以问问你的账。</p></div>
    <form className="natural-composer" onSubmit={event => void submit(event)}>
      <label className="sr-only" htmlFor="assistant-question">记账或问小满</label>
      <textarea ref={input} id="assistant-question" placeholder={clarification ? "补充这条信息就好…" : "比如：今天午饭35元，工资到账8000元"} value={text} onChange={event => { setText(event.target.value); setSource("text"); }} maxLength={1000} rows={3} disabled={working || busy} />
      <div className="composer-tools"><VoiceInput disabled={hidden || working || busy} onResult={value => { setText(current => current ? `${current} ${value}` : value); setSource("voice"); input.current?.focus(); }} /><div>{working ? <button key="cancel-request" type="button" onClick={event => { event.preventDefault(); request.current?.abort(); request.current = null; setWorking(false); setMessage("已取消，文字保留。 "); }}>取消</button> : <button key="send-request" className="primary" type="submit" aria-label="发送给小满" disabled={!text.trim() || busy}>发送</button>}</div></div>
    </form>
    <div className="composer-foot"><button data-testid="home-action-add" onClick={onManual}>手动记一笔</button><details><summary>数据怎么使用</summary><p>发送时，输入文字和所选日期的收支汇总会交给 Dify 与模型处理，不发送逐笔账目。语音由浏览器提供的识别服务转成文字。账目保存到本机。</p></details></div>
    <div className="assistant-result" aria-live="polite" aria-busy={working}>
      {working && <p className="thinking" role="status">小满正在整理…</p>}
      {message && <p className="inline-error" role="alert">{message}</p>}
      {clarification && <div className="clarification"><p>{clarification.question}</p><button onClick={reset}>重新说一笔</button></div>}
      {drafts.length > 0 && <section className="draft-preview" aria-label="待保存账目"><div className="section-title"><h3>整理好了，看看对不对</h3><span>{drafts.length} 笔 · 尚未保存</span></div>
        {drafts.map((draft, index) => <article key={draft.id} className="draft-row">
          <div className="draft-summary"><div><b>{draft.note || draft.category}</b><small>{draft.type === "income" ? "收入" : `支出 · ${draft.nature_suggestion ?? "消费"}`} · {draft.category} · {draft.occurred_at === today ? "今天" : draft.occurred_at}</small></div><strong className={draft.type}>{draft.type === "income" ? "+" : "−"}{money(draft.amount)}</strong><button aria-label={`修改第${index + 1}笔`} onClick={() => setEditing(current => current === draft.id ? null : draft.id)}>{editing === draft.id ? "收起" : "修改"}</button></div>
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
      {answer && answer.revision === revision && answer.reportKey === reportKey && <section className="answer-copy" data-testid="ai-answer"><p className="ai-question">{lastText}</p><p className="ai-answer-text">{answer.answer}</p>{answer.nextActions.length > 0 && <ul>{answer.nextActions.map((action, index) => <li key={index}>{action}</li>)}</ul>}<p className="helper">依据 {report.range.startDate} — {report.range.endDate} 的账本统计。可到「账单」调整范围。</p></section>}
    </div>
  </section>;
}
