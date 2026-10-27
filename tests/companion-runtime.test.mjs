import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAssistantRequest} from '../lib/ai/assistant-handler.ts';
import {converse} from '../lib/ai/conversation-client.ts';
import {validateConversationRequest,validateConversationOutput,conversationResult} from '../lib/ai/conversation-contract.ts';
import {renderCompanionAnswer} from '../lib/ai/companion-contract.ts';
import {companionRequest,companionOutput,companionDraft,savedExpense,buildCompanionCases} from '../evals/companion-cases.mjs';
const endpoint='https://test.example/api/ai/assistant',origin='https://molly-gith.github.io';
const env={AI_ALLOWED_ORIGINS:origin,DIFY_API_KEY:'test-secret-only',DIFY_MODEL_VERSION:'test-model',DIFY_WORKFLOW_VERSION:'test-companion'};
const versions={modelVersion:env.DIFY_MODEL_VERSION,workflowVersion:env.DIFY_WORKFLOW_VERSION};
const req=body=>new Request(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const deps=value=>{const calls=[];return {calls,checkLimit:async()=>({rateLimited:false}),fetchFn:async(url,options)=>{calls.push({url,options});return Response.json({data:{status:'succeeded',outputs:{result_json:value}}});}};};
test('companion request carries bounded facts and finite history through one isolated operation, no full ledgers or provider conversation',async()=>{
 const body=companionRequest();body.memory.recentMessages=[{role:'user',content:'刚才在网页保存过一笔，我想聊聊'},{role:'assistant',content:'你可以说说现在的想法。'}];
 const value=companionOutput(),d=deps(value),response=await handleAssistantRequest(req(body),env,d);
 assert.equal(response.status,200);assert.equal(d.calls.length,1);assert.deepEqual(await response.json(),{status:'answer',answer:value.answer,nextActions:[]});
 const sent=JSON.parse(d.calls[0].options.body);assert.equal(sent.inputs.operation,'assistLedgerCompanion');assert.equal(sent.conversation_id,undefined);
 const p=JSON.parse(sent.inputs.payload);assert.deepEqual(p.memory,body.memory);assert.deepEqual(p.companion,body.companion);
 for(const key of ['transactions','otherLedgers','ownerId','salaryBudget'])assert.equal(p[key],undefined);
});
test('normal qualitative follow-ups survive unchanged instead of the old generic product-help replacement',()=>{
 for(const answer of ['我听到了，你今天有些累。真喜欢就享受，不用为这一笔审判自己。','好，先不劝你省钱。说说今天发生了什么吧。','这笔值不值，可以先看它有没有满足你真正想要的。','钱包先举个手，决定权还是你的。']){
  const result=conversationResult(companionOutput({answer}),companionRequest(),versions);assert.equal(result.answer,answer);
 }
});
test('referenced slots insert exact scoped numeric clauses and authored natural answers remain useful',()=>{
 const body=companionRequest('给点建议',{lunchReference:14},[savedExpense(28)]);
 const answer='[[fact:day_lunch_equivalent_hundredths]]。只是换个角度看，选择还是你的。';
 const result=conversationResult(companionOutput({answer,referenced_facts:['day_lunch_equivalent_hundredths']}),body,versions);
 assert.match(result.answer,/28.00元/);assert.match(result.answer,/每顿14.00元/);assert.match(result.answer,/2顿/);assert(!result.answer.includes('[[fact:'));
 for(const c of buildCompanionCases())assert.equal(conversationResult(c.referenceOutput,c.request,versions).status,c.expected.status,c.id);
});
test('uncited/copied numbers, mismatched placeholders and invented financial claims fail semantic rendering even with valid fact IDs',()=>{
 const body=companionRequest('提醒我',{lunchReference:14},[savedExpense(28)]),c=body.companion;
 const bad=[
  ['你今天花了28元。',[]],['你今天花了九千元。',[]],['[[fact:day_expense_fen]]，你已经超支了。',['day_expense_fen']],
  ['这杯就是两顿午餐。',[]],['相当于午饭的钱。',[]],['[[fact:day_expense_fen]]',[]],['[[fact:lunch_reference_fen]]',['day_expense_fen']],
  ['[[fact:day_expense_fen]][[fact:day_expense_fen]]',['day_expense_fen']],['[[fact:bank_balance]]',['bank_balance']],
  ['[[fact:day_expense_fen]]，你的余额还有很多。',['day_expense_fen']],['消费比昨天少多了。',[]],
 ];
 for(const [answer,refs] of bad){assert.equal(renderCompanionAnswer(answer,refs,c),null,answer);const result=conversationResult(companionOutput({answer,referenced_facts:refs}),body,versions);assert.notEqual(result.answer,answer);}
});
test('companion cannot claim saving, insult people, invent health effects, advise skipping meals or assign waste',()=>{
 const c=companionRequest().companion;
 for(const answer of ['已经为你保存了。','我帮你记好了。','已经记录到你的账本。','少吃午饭就省钱了。','已到账了，放心。','我会记住你的选择。','你真是败家子。','奶茶可以减肥。','喝奶茶会伤胃。','这杯就是浪费。','保证收益，买入这只股票吧。']){
  assert.equal(renderCompanionAnswer(answer,[],c),null,answer);
 }
});
test('scope, malformed facts, hidden fields and excessive history fail before a provider call',async()=>{
 const mutations=[b=>b.companion.ledgerKind='family',b=>b.companion.today='2026-10-26',b=>b.companion.transactions=[],b=>b.companion.facts[0].value=1.2,
  b=>b.companion.facts.push({id:'bank_balance',value:50000}),b=>b.memory.recentMessages=Array.from({length:9},()=>({role:'user',content:'hi'}))];
 for(const mutate of mutations){const b=companionRequest();mutate(b);const d=deps(companionOutput());assert(!validateConversationRequest(b));assert.equal((await handleAssistantRequest(req(b),env,d)).status,400);assert.equal(d.calls.length,0);}
});
test('new output remains single-intent and legacy requests cannot opt into companion with model output alone',async()=>{
 const b=companionRequest(),bad=[companionOutput({transactions:[companionDraft()]}),companionOutput({query:{range:b.defaultRange,type:'all',metric:'total'}}),
  companionOutput({referenced_facts:['bank_balance']}),companionOutput({executeSQL:'SELECT *'}),companionOutput({intent:'transactions',transactions:[companionDraft()],answer:'',referenced_facts:['day_expense_fen']})];
 for(const value of bad){assert(!validateConversationOutput(value,b.context.today,b.companion));assert.equal((await handleAssistantRequest(req(b),env,deps(value))).status,502);}
 const old={...b};delete old.companion;assert(!validateConversationOutput(companionOutput(),b.context.today));
 assert.equal((await handleAssistantRequest(req(old),env,deps(companionOutput()))).status,502);
});
test('own transfer and waste protections apply unchanged through the companion branch; drafts never claim persisted',()=>{
 const transfer=conversationResult(companionOutput({intent:'transactions',transactions:[companionDraft({type:'income',amount:2000,category:'收入',nature_suggestion:null})],answer:''}),companionRequest('从我另一张卡转来2000元'),versions);
 assert.equal(transfer.status,'answer');assert.match(transfer.answer,/不属于新增收入/);assert.equal(transfer.drafts,undefined);
 const saved=conversationResult(companionOutput({intent:'transactions',transactions:[companionDraft({nature_suggestion:'浪费'})],answer:''}),companionRequest('咖啡28元，不是浪费'),versions);
 assert.equal(saved.status,'transactions');assert.equal(saved.drafts[0].nature_suggestion,'消费');assert.equal(saved.answer,undefined);
});
test('client preserves the companion context and still handles cancellation/deadline without retry',async()=>{
 const b=companionRequest();let captured,calls=0;
 const answer={status:'answer',answer:'先歇一下也可以。',nextActions:[]};
 assert.deepEqual(await converse({...b,endpoint},{fetchFn:async(_url,options)=>{captured=options;return Response.json(answer);}}),answer);
 assert.deepEqual(JSON.parse(captured.body),b);assert.equal(captured.credentials,'omit');assert.equal(captured.headers.Authorization,undefined);
 const result=await converse({...b,endpoint},{timeoutMs:5,fetchFn:async()=>{calls++;return new Promise(()=>{});}});
 assert.equal(result.status,'unavailable');assert.equal(calls,1);assert.equal(result.originalText,b.text);
});
