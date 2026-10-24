"use client";
import { useEffect, useId, useRef, useState } from "react";
import { StoryIcon } from "./story-icons";

type SpeechResult = ArrayLike<{ transcript: string }> & { isFinal?: boolean };
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type Session = { recognition: Recognition; cancel: () => void; stop: () => void };

function detach(recognition: Recognition) {
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
}

/** Speech supplies editable text only. The caller owns parsing and confirmation. */
export function VoiceInput({ onResult, disabled = false }: { onResult: (text: string) => void; disabled?: boolean }) {
  const [status, setStatus] = useState<"idle" | "listening" | "processing">("idle");
  const [message, setMessage] = useState("");
  const active = useRef<Session | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageId = useId();

  function clearTimer() {
    if (timeout.current !== null) clearTimeout(timeout.current);
    timeout.current = null;
  }
  useEffect(() => () => {
    if (timeout.current !== null) clearTimeout(timeout.current);
    const session = active.current;
    active.current = null;
    if (session) {
      detach(session.recognition);
      try { session.recognition.abort(); } catch { /* Already stopped. */ }
    }
  }, []);
  useEffect(() => {
    if (disabled) active.current?.cancel();
  }, [disabled]);

  function begin() {
    if (disabled || active.current) return;
    const browser = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) {
      setMessage("这个浏览器不支持网页语音。可以使用键盘上的麦克风，或直接输入。");
      return;
    }
    let recognition: Recognition;
    try { recognition = new Constructor(); }
    catch {
      setMessage("语音未能启动。可以使用键盘上的麦克风，或直接输入。");
      return;
    }
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    let transcript = "";

    function finish(messageText: string, deliver = false) {
      if (active.current?.recognition !== recognition) return;
      clearTimer();
      active.current = null;
      detach(recognition);
      setStatus("idle");
      setMessage(messageText);
      if (deliver && transcript) onResult(transcript);
    }
    function cancel() {
      finish("已取消录音，输入内容保持不变。");
      try { recognition.abort(); } catch { /* Already stopped. */ }
    }
    function stop() {
      if (active.current?.recognition !== recognition) return;
      clearTimer();
      setStatus("processing");
      setMessage("正在转成文字…");
      try { recognition.stop(); }
      catch {
        finish("录音未能完成，请重试或直接输入。");
        try { recognition.abort(); } catch { /* Already stopped. */ }
        return;
      }
      if (active.current?.recognition === recognition) timeout.current = setTimeout(() => {
        finish("语音转换超时，请重试或直接输入。");
        try { recognition.abort(); } catch { /* Already stopped. */ }
      }, 12000);
    }
    active.current = { recognition, cancel, stop };
    recognition.onresult = event => {
      if (active.current?.recognition !== recognition) return;
      transcript = Array.from(event.results).filter(result => result.isFinal !== false)
        .map(result => result[0]?.transcript.trim() ?? "").filter(Boolean).join(" ");
    };
    recognition.onerror = event => {
      const failure = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "麦克风未获授权。可以在浏览器设置中允许，或使用键盘输入。"
        : event.error === "no-speech" ? "没有听清，请重试或直接输入。"
          : event.error === "audio-capture" ? "没有可用的麦克风，请检查设备或直接输入。"
            : "语音连接暂不可用，输入内容已保留，可继续手动输入。";
      finish(failure);
      try { recognition.abort(); } catch { /* Already stopped. */ }
    };
    recognition.onend = () => finish(transcript ? "文字已填入，检查后再发送。" : "没有收到文字，请重试或直接输入。", true);
    setStatus("listening");
    setMessage("正在听，说完后点停止。语音识别可能使用浏览器的在线服务。");
    try {
      recognition.start();
      if (active.current?.recognition === recognition) timeout.current = setTimeout(stop, 30000);
    } catch {
      finish("语音未能启动，请重试或直接输入。");
      try { recognition.abort(); } catch { /* Already stopped. */ }
    }
  }

  return <div className="voice-input" data-state={status}>
    <div className="voice-input-actions">
      <button className="voice-input-button" type="button" disabled={disabled || status === "processing"}
        aria-label={status === "listening" ? "停止录音" : status === "processing" ? "正在转成文字" : "语音输入"}
        aria-describedby={message ? messageId : undefined} title="浏览器语音识别可能使用其在线服务"
        onClick={status === "listening" ? () => active.current?.stop() : begin}>
        {status === "listening" ? <span className="voice-stop-mark" aria-hidden="true" /> : <StoryIcon name="mic" />}
        <span>{status === "listening" ? "停止" : status === "processing" ? "转写中" : "语音"}</span>
      </button>
      {status !== "idle" && <button className="voice-input-cancel" type="button" onClick={() => active.current?.cancel()} aria-label="取消录音">取消</button>}
    </div>
    <p id={messageId} className="voice-input-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
