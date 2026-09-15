"use client";
import { useEffect, useRef, useState } from 'react';
import { StoryIcon } from './story-icons';
type Recognition = { lang:string; interimResults:boolean; start:()=>void; stop:()=>void; abort:()=>void;
  onresult:((e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null;
  onerror:((e:{error:string})=>void)|null; onend:(()=>void)|null };
export function VoiceNote({onText}:{onText:(value:string)=>void}) {
  const [status,setStatus]=useState<'idle'|'listening'|'processing'>('idle');
  const [message,setMessage]=useState('点一下开始，说完再点停止');
  const active=useRef<Recognition|null>(null);
  const timeout=useRef<ReturnType<typeof setTimeout>|null>(null);
  function clearTimer(){if(timeout.current)clearTimeout(timeout.current);timeout.current=null;}
  useEffect(()=>()=>{clearTimer();if(active.current){active.current.onresult=null;active.current.onerror=null;active.current.onend=null;active.current.abort();}},[]);
  function begin(){
    const win=window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
    const Constructor=win.SpeechRecognition??win.webkitSpeechRecognition;
    if(!Constructor){setMessage('这个浏览器暂不支持语音，请在上方输入备注。');return;}
    const recognition=new Constructor(); active.current=recognition; recognition.lang='zh-CN';recognition.interimResults=false;
    let received=false;
    recognition.onresult=e=>{if(active.current!==recognition)return;const text=e.results[0]?.[0]?.transcript?.trim();if(text){received=true;onText(text.slice(0,100));setMessage('已填入备注，检查一下就好。');}};
    recognition.onerror=e=>{if(active.current!==recognition)return;received=true;setStatus('idle');clearTimer();active.current=null;recognition.onresult=null;recognition.onend=null;recognition.onerror=null;recognition.abort();setMessage(e.error==='not-allowed'?'麦克风未获授权。可在浏览器设置中允许，或直接输入备注。':e.error==='no-speech'?'没有听清，点麦克风再试一次。':'语音连接暂不可用，已保留备注，可继续手动输入。');};
    recognition.onend=()=>{if(active.current!==recognition)return;setStatus('idle');clearTimer();active.current=null;if(!received)setMessage('没有收到文字，点麦克风重试，或直接输入。');};
    try{recognition.start();setStatus('listening');setMessage('正在听，点停止结束录音');timeout.current=setTimeout(()=>finish(),30000);}
    catch{setStatus('idle');active.current=null;setMessage('未能启动麦克风，请重试或直接输入备注。');}
  }
  function finish(){clearTimer();const recognition=active.current;if(!recognition)return;setStatus('processing');setMessage('正在转成文字…');try{recognition.stop();}catch{recognition.onresult=null;recognition.onerror=null;recognition.onend=null;active.current=null;try{recognition.abort();}catch{/* The session is already detached. */}setStatus('idle');setMessage('录音未能完成，请重试或直接输入备注。');return;}
    if(active.current===recognition)timeout.current=setTimeout(()=>{if(active.current!==recognition)return;recognition.onresult=null;recognition.onerror=null;recognition.onend=null;recognition.abort();active.current=null;setStatus('idle');setMessage('转换时间较长，请重试或直接输入备注。');},12000);
  }
  return <div className={`voice-note ${status}`}><button className="voice-control" type="button" disabled={status==='processing'} aria-label={status==='listening'?'停止录音':'用语音填写备注'} onClick={status==='listening'?finish:begin}>
    <span className="voice-microphone">{status==='listening'?<span className="stop-square"/>:<StoryIcon name="mic"/>}</span>
    <span className="voice-copy"><b>{status==='listening'?'正在听你说…':status==='processing'?'正在转成文字':'说一句，记下来'}</b><small>语音填写备注</small></span>
    <span className="voice-wave" aria-hidden="true">{[0,1,2,3,4,5,6].map(i=><i key={i}/>)}</span>
  </button><p role="status">{message}</p><small className="voice-privacy">语音识别由浏览器提供，可能使用其在线服务。</small></div>;
}
