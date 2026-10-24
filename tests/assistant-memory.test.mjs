import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createAssistantMemoryRepository, validateOwnerMemoryBackup, MAX_CONVERSATION_MESSAGES, MAX_MESSAGE_LENGTH } from '../lib/data/assistant-memory.ts';
import { applyPreferenceToDraft, parsePreferenceProposal, validatePreferenceRule } from '../lib/domain/assistant-preferences.ts';

const owner='local-owner-alice', other='local-owner-bob';
const kinds=['personal','family','travel'];
const message=(id,extra={})=>({id,role:'user',content:`对话${id}`,createdAt:'2026-10-24T12:00:00.000Z',...extra});
const rule=(extra={})=>({id:'fitness',keyword:'健身课',category:null,nature:'投资',...extra});
const draft=(extra={})=>({type:'expense',amount:200,category:'健康',occurred_at:'2026-10-24',note:'健身课',nature_suggestion:'消费',confidence:0.9,ambiguous:false,...extra});
const plan={range:{startDate:'2026-10-01',endDate:'2026-10-31'},type:'expense',categories:['餐饮'],metric:'total'};
function fixture(){const indexedDB=new IDBFactory();return {indexedDB,repo:createAssistantMemoryRepository({indexedDB})};}
const revisions=all=>Object.fromEntries(kinds.map(kind=>[kind,all[kind].revision]));
async function rawWrite(indexedDB,key,value) {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-assistant-memory-db',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('memory','readwrite');tx.objectStore('memory').put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}

test('local owner is durable and atomically shared between tabs, but not an authenticated account',async()=>{
  const {repo,indexedDB}=fixture();
  const second=createAssistantMemoryRepository({indexedDB});
  const owners=await Promise.all([repo.getLocalOwnerId(),second.getLocalOwnerId(),repo.getLocalOwnerId()]);
  assert.match(owners[0],/^local-[a-f0-9-]+$/);assert.equal(new Set(owners).size,1);
  assert.equal(await createAssistantMemoryRepository({indexedDB}).getLocalOwnerId(),owners[0]);
  assert.notEqual(await fixture().repo.getLocalOwnerId(),owners[0]);
  assert.equal((await repo.read(other,'personal')).ownerId,other,'partition selection provides no authentication');
});

test('conversations, clarification and saved query survive refresh and isolate every owner and ledger',async()=>{
  const {repo,indexedDB}=fixture();const clarification={originalText:'昨天午饭',question:'花了多少元？'};
  let saved=await repo.appendConversation(owner,'personal',[message('u'),message('a',{role:'assistant',content:'本月餐饮支出35元',query:plan})],0,clarification);
  saved=await repo.upsertPreference(owner,'personal',rule(),saved.revision);
  assert.deepEqual(await createAssistantMemoryRepository({indexedDB}).read(owner,'personal'),saved);
  for(const kind of ['family','travel'])assert.deepEqual((await repo.read(owner,kind)).conversation,[]);
  assert.deepEqual((await repo.read(other,'personal')).preferences,[]);
  await repo.appendConversation(owner,'family',[message('u',{content:'家庭对话'})],0);
  assert.equal((await repo.read(owner,'personal')).conversation[0].content,'对话u');
  assert.equal((await repo.read(owner,'family')).conversation[0].content,'家庭对话');
  const copy=await repo.read(owner,'personal');copy.conversation[0].content='被外部改动';
  assert.equal((await repo.read(owner,'personal')).conversation[0].content,'对话u');
});

test('retention trims oldest messages while bad or duplicate new messages never partially save',async()=>{
  const {repo}=fixture();let saved=await repo.appendConversation(owner,'personal',Array.from({length:40},(_,i)=>message(`m${i}`)),0);
  saved=await repo.appendConversation(owner,'personal',[message('m40'),message('m41')],saved.revision);
  assert.equal(saved.conversation.length,MAX_CONVERSATION_MESSAGES);assert.equal(saved.conversation[0].id,'m2');
  for(const batch of [[message('m41')],[message('bad',{content:'a'.repeat(MAX_MESSAGE_LENGTH+1)})],[message('bad',{role:'system'})],[message('bad',{createdAt:'2026-02-30T12:00:00.000Z'})],[message('bad',{query:plan})],[message('bad',{role:'assistant',query:{...plan,sql:'drop table'}})]]) {
    await assert.rejects(repo.appendConversation(owner,'personal',batch,saved.revision));assert.deepEqual(await repo.read(owner,'personal'),saved);
  }
  const messages=[message('capture')];const saving=repo.appendConversation(owner,'personal',messages,saved.revision);messages[0].content='late mutation';
  assert.equal((await saving).conversation.at(-1).content,'对话capture');
});

test('replace and clear conversation preserve preferences and clear pending clarification',async()=>{
  const {repo}=fixture();let state=await repo.upsertPreference(owner,'personal',rule(),0);
  state=await repo.appendConversation(owner,'personal',[message('old')],state.revision,{originalText:'午饭',question:'金额？'});
  state=await repo.replaceConversation(owner,'personal',[message('new')],state.revision,null);
  assert.deepEqual(state.conversation.map(x=>x.id),['new']);assert.equal(state.clarification,null);
  state=await repo.clearConversation(owner,'personal',state.revision);
  assert.deepEqual(state.conversation,[]);assert.deepEqual(state.preferences,[rule()]);
});

test('same-scope simultaneous writers conflict atomically and other scopes remain independent',async()=>{
  const {repo,indexedDB}=fixture();const second=createAssistantMemoryRepository({indexedDB});
  const results=await Promise.allSettled([repo.appendConversation(owner,'personal',[message('a')],0),second.upsertPreference(owner,'personal',rule(),0)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/其他页面更新/);
  assert.equal((await repo.read(owner,'personal')).revision,1);
  await Promise.all([repo.appendConversation(owner,'family',[message('family')],0),second.appendConversation(other,'personal',[message('bob')],0)]);
  assert.equal((await repo.read(owner,'family')).conversation[0].id,'family');
  assert.equal((await repo.read(other,'personal')).conversation[0].id,'bob');
});

test('preference CRUD rejects duplicate normalized keywords, invalid targets and excessive rules',async()=>{
  const {repo}=fixture();let state=await repo.upsertPreference(owner,'personal',rule(),0);
  state=await repo.upsertPreference(owner,'personal',rule({keyword:'私教课',category:'学习',nature:'消费'}),state.revision);
  assert.equal(state.preferences.length,1);assert.equal(state.preferences[0].keyword,'私教课');
  await assert.rejects(repo.upsertPreference(owner,'personal',rule({id:'second',keyword:'私教课'}),state.revision));
  for(const bad of [rule({category:'收入'}),rule({nature:null}),rule({nature:['投资']}),rule({keyword:'x'}),rule({keyword:' 健身课'}),{...rule(),ownerId:other}])await assert.rejects(repo.upsertPreference(owner,'personal',bad,state.revision));
  state=await repo.deletePreference(owner,'personal','fitness',state.revision);assert.deepEqual(state.preferences,[]);
  await assert.rejects(repo.deletePreference(owner,'personal','missing',state.revision));
  for(let i=0;i<50;i++)state=await repo.upsertPreference(owner,'personal',rule({id:`r${i}`,keyword:`项目${i}`}),state.revision);
  await assert.rejects(repo.upsertPreference(owner,'personal',rule({id:'excess',keyword:'额外项目'}),state.revision));
  assert.equal((await repo.read(owner,'personal')).preferences.length,50);
});

test('clear all conversations keeps rules, full clear removes rules and stale saves cannot resurrect memory',async()=>{
  const {repo}=fixture();
  for(const kind of kinds){await repo.appendConversation(owner,kind,[message(kind)],0);await repo.upsertPreference(owner,kind,rule(),1);}
  await repo.appendConversation(other,'personal',[message('bob')],0);
  let all=await repo.clearOwnerConversations(owner);
  for(const kind of kinds){assert.deepEqual(all[kind].conversation,[]);assert.equal(all[kind].preferences.length,1);assert.equal(all[kind].revision,3);}
  all=await repo.clearOwner(owner);
  for(const kind of kinds){assert.deepEqual(all[kind].preferences,[]);assert.equal(all[kind].revision,4);}
  await assert.rejects(repo.appendConversation(owner,'family',[message('stale')],2),/其他页面更新/);
  assert.equal((await repo.read(other,'personal')).conversation.length,1);
});

test('portable backup restores all three books into target owner without importing identity or revisions',async()=>{
  const {repo}=fixture();
  for(const kind of kinds){await repo.appendConversation(owner,kind,[message(kind)],0);await repo.upsertPreference(owner,kind,rule(),1);}
  const backup=await repo.exportOwner(owner);
  assert.equal(validateOwnerMemoryBackup(backup),true);assert.doesNotMatch(JSON.stringify(backup),/ownerId|revision|local-owner/);
  const before=await repo.readOwner(other);const imported=await repo.importOwner(other,backup,revisions(before));
  for(const kind of kinds){assert.equal(imported[kind].ownerId,other);assert.equal(imported[kind].revision,1);assert.equal(imported[kind].conversation[0].id,kind);}
  assert.equal((await repo.read(owner,'personal')).revision,2);
  const original=await repo.readOwner(other);
  for(const mutate of [b=>{b.ownerId=owner;},b=>{delete b.ledgers.family;},b=>{b.ledgers.travel.ownerId=owner;},b=>{b.ledgers.travel.preferences[0].nature='收入';},b=>{b.ledgers.travel.conversation[0].role='system';}]) {
    const bad=structuredClone(backup);mutate(bad);await assert.rejects(repo.importOwner(other,bad,revisions(original)));assert.deepEqual(await repo.readOwner(other),original);
  }
});

test('one stale inactive revision makes a complete memory import fail without any partial overwrite',async()=>{
  const {repo}=fixture();const snapshot=await repo.readOwner(owner), backup=await repo.exportOwner(other);
  await repo.appendConversation(owner,'travel',[message('new')],0);
  await assert.rejects(repo.importOwner(owner,backup,revisions(snapshot)),/其他页面更新/);
  assert.equal((await repo.read(owner,'travel')).conversation[0].id,'new');assert.equal((await repo.read(owner,'personal')).revision,0);
});

test('damaged saved records and owner metadata fail closed without resetting data or reassigning identity',async()=>{
  const {repo,indexedDB}=fixture();await repo.getLocalOwnerId();
  const valid=await repo.read(owner,'family');const key=JSON.stringify([owner,'family']);
  for(const mutate of [v=>{v.ownerId=other;},v=>{v.revision=-1;},v=>{v.conversation=[message('x',{role:'system'})];},v=>{v.preferences=[rule({nature:'invalid'})];},v=>{v.extra='ignored?';}]) {
    const bad=structuredClone(valid);mutate(bad);await rawWrite(indexedDB,key,bad);
    await assert.rejects(repo.read(owner,'family'),/无效/);await assert.rejects(repo.appendConversation(owner,'family',[message('new')],0));
  }
  await rawWrite(indexedDB,'localOwnerId','invalid identity!');await assert.rejects(repo.getLocalOwnerId(),/无效/);
  assert.deepEqual((await repo.read(owner,'personal')).conversation,[]);
});

test('failed durable commits reject rather than returning a successful in-memory save',async()=>{
  const {repo,indexedDB}=fixture();await repo.read(owner,'personal');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-assistant-memory-db',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const prototype=Object.getPrototypeOf(db.transaction('memory').objectStore('memory'));db.close();
  const original=prototype.put;
  try {
    prototype.put=function(){throw new DOMException('空间不足','QuotaExceededError');};
    await assert.rejects(repo.appendConversation(owner,'personal',[message('lost')],0),/空间不足/);
  } finally {prototype.put=original;}
  assert.equal((await repo.read(owner,'personal')).revision,0);assert.deepEqual((await repo.read(owner,'personal')).conversation,[]);
});

test('explicit keyword preference changes only category/nature with an explainable match; income is never changed',()=>{
  const original=draft();const result=applyPreferenceToDraft(original,[rule({category:'学习'})]);
  assert.equal(result.draft.nature_suggestion,'投资');assert.equal(result.draft.category,'学习');assert.match(result.reason,/本账本.*健身课/);
  assert.equal(result.preferenceId,'fitness');assert.equal(result.draft.amount,200);assert.equal(result.draft.occurred_at,original.occurred_at);assert.equal(original.nature_suggestion,'消费');
  const income=draft({type:'income',category:'收入',nature_suggestion:null});assert.deepEqual(applyPreferenceToDraft(income,[rule()]).draft,income);
  assert.equal(applyPreferenceToDraft(draft({note:'午餐'}),[rule()],'午餐35和健身课200').preferenceId,null);
  assert.equal(applyPreferenceToDraft(draft({note:'paid会员'}),[rule({keyword:'AI'})]).preferenceId,null);
});

test('negated or explicitly overridden preferences never replace the user current choice',()=>{
  for(const text of ['不是健身课，是午餐','健身课不算投资','这次健身课不要按投资','健身课记为消费','删除健身课偏好','健身课不属于投资','健身课200，这次不算投资','健身课200，记为消费']) {
    assert.equal(applyPreferenceToDraft(draft(),[rule()],text).preferenceId,null,text);
  }
  assert.equal(applyPreferenceToDraft(draft({note:'不是健身课'}),[rule()]).preferenceId,null);
  const rules=[rule(),rule({id:'food',keyword:'午餐',nature:'消费'})];
  assert.equal(applyPreferenceToDraft(draft({note:'健身课和午餐'}),rules).preferenceId,null,'conflicting distinct purposes need user confirmation');
  assert.equal(applyPreferenceToDraft(draft(),[rule({id:'generic',keyword:'健身',nature:'消费'}),rule()]).preferenceId,'fitness');
});

test('current explicit nature and category instructions override saved preferences without rewriting the draft',()=>{
  const original=draft({amount:286.5});
  for(const text of ['今天健身课286.5，这次按消费','今天健身课286.5，这次按照正常消费记账','今天健身课286.5，这次作为消费','今天健身课286.5，性质归到消费类']) {
    const result=applyPreferenceToDraft(original,[rule()],text);
    assert.deepEqual(result.draft,original,text);assert.equal(result.preferenceId,null,text);assert.equal(result.reason,null,text);
  }
  const categorized=draft({amount:168,category:'娱乐'}),saved=rule({category:'健康'});
  for(const text of ['健身课168，这次分类为娱乐','健身课168，这笔归到娱乐类','健身课168，这次分类按娱乐','健身课168，本次作为娱乐记录']) {
    const result=applyPreferenceToDraft(categorized,[saved],text);
    assert.deepEqual(result.draft,categorized,text);assert.equal(result.preferenceId,null,text);assert.equal(result.reason,null,text);
  }
  const income=draft({type:'income',amount:400,category:'收入',nature_suggestion:null});
  assert.deepEqual(applyPreferenceToDraft(income,[saved],'健身课退款400，这次按消费').draft,income);
  assert.equal(applyPreferenceToDraft(draft({note:'地铁',category:'交通'}),[saved],'地铁6元和健身课168，这次按消费').preferenceId,null,'full input never matches a different draft');
});

test('ordinary descriptions and matching instructions do not suppress a saved preference',()=>{
  const saved=rule({category:'健康'});
  for(const text of ['今天健身课200，按消费能力安排课程','今天健身课200，教练讲了交通规则','今天健身课200，作为娱乐活动放松一下','今天健身课200，这次按投资','今天健身课200，这次分类为健康']) {
    const result=applyPreferenceToDraft(draft(),[saved],text);
    assert.equal(result.preferenceId,'fitness',text);assert.equal(result.draft.nature_suggestion,'投资',text);assert.equal(result.draft.category,'健康',text);
  }
});

test('natural-language preference recognition requires explicit future intent and always asks for confirmation',()=>{
  for(const text of ['记住，健身课算投资','以后把健身课记为投资','以后将奶茶记为消费','记住：健身课=投资']) {
    const proposal=parsePreferenceProposal(text);assert.equal(proposal?.requiresConfirmation,true,text);assert.equal(validatePreferenceRule({id:'confirmed',keyword:proposal.keyword,category:proposal.category,nature:proposal.nature}),true);
  }
  for(const text of ['记住，以后健身课算投资','请记住，今后把健身课记为投资','记住：从今以后，健身课算投资']) {
    const proposal=parsePreferenceProposal(text);assert.equal(proposal?.keyword,'健身课',text);
    const applied=applyPreferenceToDraft(draft(),[{id:'confirmed',keyword:proposal.keyword,category:proposal.category,nature:proposal.nature}],'今天健身课200元');
    assert.equal(applied.draft.nature_suggestion,'投资',text);assert.equal(applied.preferenceId,'confirmed');
  }
  for(const text of ['健身课200算投资','把今天的健身课记为投资','不要记住健身课算投资','以后健身课不算投资','以后把健身课记为投资吗？','记住今天健身课200算投资','记住所有支出算投资'])assert.equal(parsePreferenceProposal(text),null,text);
});
