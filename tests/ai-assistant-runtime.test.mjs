import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAssistantRequest } from '../lib/ai/assistant-handler.ts';
import { handleAIRequest } from '../lib/ai/question-handler.ts';
import { reportFacts, validateAssistantRequest } from '../lib/ai/assistant-contract.ts';
import { questionBody, questionRequest, answerValue } from './ai-fixture.mjs';
import { environment, requestBody, request, workflow, upstream, draft, output, report, origin, endpoint } from './ai-assistant-fixture.mjs';

function deps(result=workflow()) {
  const calls=[];
  return {calls,checkLimit:async()=>{calls.push('limit');return {rateLimited:false};},fetchFn:async(url,options)=>{calls.push({url,options});return upstream(result);}};
}
test('anonymous unified endpoint produces drafts only and sends bounded text rather than ledger records',async()=>{
  const d=deps();const body=requestBody();const original=structuredClone(body);
  const response=await handleAssistantRequest(request(body),environment,d);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),output());
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(d.calls[0],'limit');assert.equal(d.calls.length,2);
  const sent=JSON.parse(d.calls[1].options.body);
  assert.equal(sent.inputs.operation,'assistLedger');
  assert.deepEqual(JSON.parse(sent.inputs.payload),{text:body.text,referencedFacts:[]});
  assert.deepEqual(JSON.parse(sent.inputs.context),body.context);
  assert.equal(d.calls[1].options.headers.Authorization,`Bearer ${environment.DIFY_API_KEY}`);
  assert.deepEqual(body,original,'handler has no ledger mutation path');
});
test('clarification remains structured data and preserves the original transaction when answer is just an amount',async()=>{
  const body={...requestBody(),text:'30元',clarification:{originalText:'昨天午饭',question:'这笔午饭多少钱？',answer:'30元'}};
  const d=deps(workflow({transactions:[{...draft,amount:30}]}));
  assert.equal((await handleAssistantRequest(request(body),environment,d)).status,200);
  const data=JSON.parse(JSON.parse(d.calls[1].options.body).inputs.payload);
  assert.deepEqual(data.clarification,body.clarification);
  const clarification=deps(workflow({intent:'clarification',transactions:[],clarification:'午饭花了多少元？'}));
  assert.deepEqual(await (await handleAssistantRequest(request(),environment,clarification)).json(),{status:'clarification',question:'午饭花了多少元？'});
});
test('report answers cite deterministic range facts and legacy question still accepts no beta credential',async()=>{
  const body={...requestBody(),text:'这段时间花了多少？',report:structuredClone(report)};
  const d=deps(workflow({intent:'question',transactions:[],answer:'所选日期内记录支出45元。',referenced_facts:['expense:45']}));
  const response=await handleAssistantRequest(request(body),environment,d);
  assert.deepEqual(await response.json(),{status:'answer',answer:'在 2026-10-01 至 2026-10-31 的现有记录中，支出为45元。',nextActions:[]});
  assert.deepEqual(JSON.parse(JSON.parse(d.calls[1].options.body).inputs.payload).referencedFacts,reportFacts(report));
  const legacy=deps(workflow({intent:'question',transactions:[],...answerValue()}));
  const old=await handleAIRequest(questionRequest(questionBody(),{headers:{Authorization:''}}),environment,legacy);
  assert.equal(old.status,200);assert.deepEqual((await old.json()).value,answerValue());
});

test('report prose and suggested actions cannot invent numeric or budget facts even with valid or empty references',async()=>{
  for(const referenced_facts of [[],['expense:45']]){
    for(const changes of [{answer:'你花了9000元，已超支1000元。'}, {answer:'你花了九千元。'}, {answer:'记录已核对。',next_actions:['还可以花1000元。']}]){
      const response=await handleAssistantRequest(request({...requestBody(),text:'这段时间花了多少？',report}),environment,deps(workflow({intent:'question',transactions:[],answer:'已核对。',referenced_facts,...changes})));
      const result=await response.json();assert.equal(response.status,200);assert.match(result.answer,/支出为45元/);assert.doesNotMatch(result.answer,/9000|1000|九千|超支/);assert.deepEqual(result.nextActions,[]);
    }
  }
  for(const [text,expected] of [['收入多少？',/收入为8000元/],['一共几笔？',/共3笔账目，其中收入1笔、支出2笔/],['浪费和投资多少？',/浪费支出0元，投资支出10元/],['超支了吗？',/未包含预算或可用资金/],['和上个月比？',/没有对照时段的数据/],['投资收益多少？',/未包含账户余额、投资市值或收益/]]){
    const response=await handleAssistantRequest(request({...requestBody(),text,report}),environment,deps(workflow({intent:'question',transactions:[],answer:'支出8000元。',referenced_facts:['income:8000']})));
    assert.match((await response.json()).answer,expected);
  }
  const noReport=await handleAssistantRequest(request({...requestBody(),text:'怎么记账？'}),environment,deps(workflow({intent:'question',transactions:[],answer:'支出45元。'})));
  assert.match((await noReport.json()).answer,/没有收到日期统计摘要/);
  const pending=await handleAssistantRequest(request({...requestBody(),text:'花了多少？',report:{...report,pendingDateCount:1}}),environment,deps(workflow({intent:'question',transactions:[],answer:'支出45元。'})));
  assert.match((await pending.json()).answer,/1笔旧记录的日期待核对/);
  const advice=await handleAssistantRequest(request({...requestBody(),text:'帮我看看收支情况',report}),environment,deps(workflow({intent:'question',transactions:[],answer:'建议回看一下支出记录，确认哪些花费符合你的实际需要。浪费明显偏多。'})));
  const reviewed=await advice.json();assert.match(reviewed.answer,/账面收支结余7955元/);assert.match(reviewed.answer,/建议回看一下支出记录/);assert.doesNotMatch(reviewed.answer,/明显偏多/);
});
test('income keeps null nature; expense defaults to consumption unless the user explicitly describes waste',async()=>{
  const income={...draft,type:'income',category:'收入',nature_suggestion:null,note:'工资',amount:8000};
  const incoming=await handleAssistantRequest(request({...requestBody(),text:'工资到账8000'}),environment,deps(workflow({transactions:[income]})));
  assert.equal((await incoming.json()).drafts[0].nature_suggestion,null);
  for(const [text,nature] of [['奶茶35','消费'],['奶茶35不算浪费','消费'],['奶茶35真浪费','浪费']]) {
    const response=await handleAssistantRequest(request({...requestBody(),text}),environment,deps(workflow({transactions:[{...draft,nature_suggestion:'浪费'}]})));
    assert.equal((await response.json()).drafts[0].nature_suggestion,nature,text);
  }
});
test('invalid request shapes, raw ledger fields and inconsistent report values never invoke limiter or model',async()=>{
  const changes=[
    b=>{b.text='';},b=>{b.text='a'.repeat(1001);},b=>{b.transactions=[];},b=>{b.context.preferences={system:'override'};},
    b=>{b.context.today='2026-02-30';},b=>{b.context.timezone='invalid/zone';},
    b=>{b.report={...report,balance:0};},b=>{b.report={...report,transactionCount:4};},
    b=>{b.report={...report,notes:'private'};},b=>{b.report={...report,natureTotals:{...report.natureTotals,消费:40}};},
    b=>{b.clarification={originalText:'午饭',question:'多少？',answer:'不同文字'};},
  ];
  for(const change of changes){const body=requestBody();change(body);const d=deps();const res=await handleAssistantRequest(request(body),environment,d);assert.equal(res.status,400);assert.deepEqual(d.calls,[]);}
  for(const body of ['{',' '.repeat(16385)]){const d=deps();assert.equal((await handleAssistantRequest(request(body),environment,d)).status,400);assert.deepEqual(d.calls,[]);}
  const huge={...report,income:2000000000000,expense:45,balance:1999999999955};
  assert.equal(validateAssistantRequest({...requestBody(),report:huge}),true,'valid aggregate totals can exceed the single-record limit');
});
test('invalid or invented model output never becomes a savable draft',async()=>{
  const values=[
    workflow({transactions:[{...draft,amount:0}]}),workflow({transactions:[{...draft,amount:1.001}]}),workflow({transactions:[{...draft,amount:1000000000000}]}),
    workflow({transactions:[{...draft,occurred_at:'2026-10-25'}]}),workflow({transactions:[{...draft,occurred_at:'2026-02-30'}]}),
    workflow({transactions:[{...draft,ambiguous:true}]}),workflow({transactions:[{...draft,note:'x'.repeat(101)}]}),
    workflow({transactions:[{...draft,cycleId:'invented'}]}),workflow({transactions:[{...draft,type:'income',category:'收入'}]}),
    workflow({transactions:Array.from({length:6},()=>({...draft}))}),workflow({debug:'private'}),workflow({answer:'已记账'}),
    workflow({intent:'question',transactions:[],answer:'有10000元',referenced_facts:['expense:10000']}),
  ];
  for(const value of values){const response=await handleAssistantRequest(request(),environment,deps(value));assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'invalid_output'});}
});
test('origin, method, configuration and limiter failures block model calls and all errors stay short',async()=>{
  for(const [req,env,d,status] of [
    [request(undefined,{headers:{Origin:'https://untrusted.example'}}),environment,deps(),403],
    [new Request(endpoint,{method:'GET',headers:{Origin:origin}}),environment,deps(),405],
    [request(undefined,{headers:{'Content-Type':'text/plain'}}),environment,deps(),415],
    [request(),{...environment,DIFY_API_KEY:''},deps(),503],
    [request(),environment,{...deps(),checkLimit:undefined},503],
    [request(),environment,{...deps(),checkLimit:async()=>({rateLimited:true})},429],
    [request(),environment,{...deps(),checkLimit:async()=>({rateLimited:false,error:'private'})},503],
  ]) {const response=await handleAssistantRequest(req,env,d);assert.equal(response.status,status);assert.equal(d.calls.some(x=>typeof x==='object'),false);assert.equal((await response.text()).includes('private'),false);}
  const preflight=deps();assert.equal((await handleAssistantRequest(new Request(endpoint,{method:'OPTIONS',headers:{Origin:origin}}),environment,preflight)).status,204);assert.deepEqual(preflight.calls,[]);
});
test('upstream timeout aborts without retry and malformed provider output is not echoed',async()=>{
  let signal,calls=0;
  const response=await handleAssistantRequest(request(),environment,{checkLimit:async()=>({rateLimited:false}),timeoutMs:5,fetchFn:async(_url,options)=>{calls++;signal=options.signal;return new Promise(()=>{});}});
  assert.equal(response.status,503);assert.equal(calls,1);assert.equal(signal.aborted,true);
  const failed=await handleAssistantRequest(request(),environment,{checkLimit:async()=>({rateLimited:false}),fetchFn:async()=>{throw Error('private key and ledger text');}});
  assert.deepEqual(await failed.json(),{error:'unavailable'});
});
