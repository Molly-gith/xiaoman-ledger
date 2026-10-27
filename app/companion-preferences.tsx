"use client";
import { useRef, useState, type FormEvent } from "react";
import type { CompanionPreferences } from "../lib/data/assistant-memory";

export function CompanionPreferencesForm({ value, today, disabled = false, onSave }: {
  value: CompanionPreferences; today: string; disabled?: boolean;
  onSave: (value: CompanionPreferences) => Promise<boolean>;
}) {
  const [tone, setTone] = useState(value.tone);
  const [reminders, setReminders] = useState(value.remindersEnabled);
  const [quiet, setQuiet] = useState(!!value.mutedUntil && value.mutedUntil >= today);
  const [lunch, setLunch] = useState(value.lunchReference === null ? "" : String(value.lunchReference));
  const [daily, setDaily] = useState(value.dailyExpenseTarget === null ? "" : String(value.dailyExpenseTarget));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || disabled) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const amount = (raw: string, allowZero = false) => {
        if (!raw.trim()) return null;
        const number = Number(raw);
        if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(number) || (allowZero ? number < 0 : number <= 0) || number > 999999999999.99) throw Error("午餐基准需大于 0，每天目标可为 0，最多两位小数，也可以留空。");
        return number;
      };
      await onSave({ tone, remindersEnabled: reminders, mutedUntil: quiet ? today : null, lunchReference: amount(lunch), dailyExpenseTarget: amount(daily, true) });
    } catch (problem) { setError(problem instanceof Error ? problem.message : "偏好尚未保存，请重试。"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <form className="companion-preferences-form" onSubmit={submit}>
    <fieldset disabled={disabled || busy}>
      <legend>希望小满怎么陪你</legend>
      <div className="companion-tones">{([{ value: "playful", label: "轻毒舌" }, { value: "gentle", label: "温柔" }, { value: "plain", label: "简洁" }] as const).map(option => <label key={option.value}><input type="radio" name="companionTone" checked={tone === option.value} onChange={() => setTone(option.value)} /><span>{option.label}</span></label>)}</div>
      <p className="helper">{tone === "playful" ? "轻轻调侃这次选择，不评价你，也不会替你判成浪费。" : tone === "gentle" ? "好好说话，一起看账，不催你做决定。" : "只说事实，少作调侃；是否提醒由下面的开关决定。"}</p>
      <label className="companion-toggle"><input type="checkbox" checked={reminders} onChange={event => setReminders(event.target.checked)} />主动提醒已记录的花费</label>
      <label className="companion-toggle"><input type="checkbox" checked={quiet} onChange={event => setQuiet(event.target.checked)} />今天少唠叨</label>
      <details className="companion-baselines"><summary>生活基准 · 选填</summary><p className="helper">用你自己的标准作比较。留空时，不猜你的生活成本。</p><div>
        <label>一顿午餐（元，选填）<input name="lunchReference" type="number" inputMode="decimal" min="0.01" max="999999999999.99" step="0.01" value={lunch} onChange={event => setLunch(event.target.value)} placeholder="例如 14" /></label>
        <label>每天花费目标（元，选填）<input name="dailyExpenseTarget" type="number" inputMode="decimal" min="0" max="999999999999.99" step="0.01" value={daily} onChange={event => setDaily(event.target.value)} placeholder="留空也可以" /></label>
      </div></details>
      <p className="helper">只根据已记账数据提醒；关闭网页后不会发送通知。</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button type="submit" className="primary">{busy ? "保存中…" : "保存陪伴偏好"}</button>
    </fieldset>
  </form>;
}
