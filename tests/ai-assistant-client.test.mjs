import test from 'node:test';
import assert from 'node:assert/strict';
import { assistLedger } from '../lib/ai/assistant-client.ts';
import { requestBody, output, draft, endpoint } from './ai-assistant-fixture.mjs';

test('unified client derives assistant endpoint and sends no credentials or account data',async()=>{
  let sent;
  const result=await assistLedger({...requestBody(),endpoint:endpoint.replace('/assistant','/question')},{fetchFn:async(url,options)=>{sent={url,options};return Response.json(output());}});
  assert.deepEqual(result,output());assert.equal(new URL(sent.url).pathname,'/api/ai/assistant');
  assert.deepEqual(sent.options.headers,{'Content-Type':'application/json'});
  assert.equal(sent.options.credentials,'omit');assert.equal(sent.options.redirect,'error');assert.equal(sent.options.cache,'no-store');
  assert.deepEqual(JSON.parse(sent.options.body),requestBody());
});
test('client retains input on failure without automatic retries or exposing upstream details',async()=>{
  for(const status of [400,401,429,500,503]) {
    let calls=0;const result=await assistLedger({...requestBody(),endpoint},{fetchFn:async()=>{calls++;return new Response('private upstream details',{status});}});
    assert.equal(result.status,'unavailable');assert.equal(result.originalText,requestBody().text);assert.equal(calls,1);assert.equal(result.reason.includes('private'),false);
  }
});
test('client refuses malformed drafts, oversized responses and unexpected top-level output',async()=>{
  for(const response of [
    ()=>Response.json(output({drafts:[{...draft,amount:-1}]})),()=>Response.json(output({debug:'extra'})),
    ()=>Response.json(output({drafts:[{...draft,occurred_at:'2026-10-25'}]})),()=>new Response(' '.repeat(16385)),
    ()=>Response.json({status:'transactions',drafts:[]}),()=>new Response('{'),
  ]) assert.equal((await assistLedger({...requestBody(),endpoint},{fetchFn:async()=>response()})).status,'unavailable');
});
test('answers and clarification return without writing; incomplete input and unsafe URLs never fetch',async()=>{
  for(const value of [{status:'answer',answer:'所选期间支出35元。',nextActions:[]},{status:'clarification',question:'午饭多少钱？'}]) {
    assert.deepEqual(await assistLedger({...requestBody(),endpoint},{fetchFn:async()=>Response.json(value)}),value);
  }
  for(const patch of [{text:''},{endpoint:'https://user:pass@example.com/api/ai/assistant'},{endpoint:'http://example.com/api/ai/assistant'},{endpoint:endpoint+'?key=secret'},{endpoint:'https://example.com/other'}]) {
    let calls=0;assert.equal((await assistLedger({...requestBody(),endpoint,...patch},{fetchFn:async()=>{calls++;return Response.json(output());}})).status,'unavailable');assert.equal(calls,0);
  }
});
test('cancellation and deadline abort the pending call and keep the original text',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  const cancelled=await assistLedger({...requestBody(),endpoint,signal:controller.signal},{fetchFn:async()=>{calls++;return Response.json(output());}});
  assert.equal(cancelled.status,'unavailable');assert.equal(calls,0);
  let signal;
  const timed=await assistLedger({...requestBody(),endpoint},{timeoutMs:5,fetchFn:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  assert.equal(timed.status,'unavailable');assert.equal(signal.aborted,true);assert.equal(timed.originalText,requestBody().text);
});
