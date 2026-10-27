import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createAssistantMemoryRepository, validateOwnerMemoryBackup, DEFAULT_COMPANION_PREFERENCES, MAX_MESSAGE_LENGTH, MAX_MEMORY_BACKUP_BYTES, normalizeMemoryContents, assertMemoryWriteCapacity, pruneExpiredMemoryContents, CONVERSATION_RETENTION_DAYS } from '../lib/data/assistant-memory.ts';
import { applyPreferenceToDraft, parsePreferenceProposal, validatePreferenceRule } from '../lib/domain/assistant-preferences.ts';

const owner='local-owner-alice', other='local-owner-bob';
const kinds=['personal','family','travel'];
const fixedNow=()=>new Date('2026-10-27T12:00:00.000Z');
const cutoff=new Date(fixedNow().getTime()-90*24*60*60*1000).toISOString();
const expiredAt=new Date(Date.parse(cutoff)-1).toISOString();
const message=(id,extra={})=>({id,role:'user',content:`对话${id}`,createdAt:'2026-10-24T12:00:00.000Z',...extra});
const rule=(extra={})=>({id:'fitness',keyword:'健身课',category:null,nature:'投资',...extra});
const draft=(extra={})=>({type:'expense',amount:200,category:'健康',occurred_at:'2026-10-24',note:'健身课',nature_suggestion:'消费',confidence:0.9,ambiguous:false,...extra});
const plan={range:{startDate:'2026-10-01',endDate:'2026-10-31'},type:'expense',categories:['餐饮'],metric:'total'};
function fixture(now=fixedNow){const indexedDB=new IDBFactory();return {indexedDB,repo:createAssistantMemoryRepository({indexedDB,now})};}
const revisions=all=>Object.fromEntries(kinds.map(kind=>[kind,all[kind].revision]));
async function rawWrite(indexedDB,key,value) {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-assistant-memory-db');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('memory','readwrite');tx.objectStore('memory').put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}

test('local owner is durable and atomically shared between tabs, but not an authenticated account',async()=>{
  const {repo,indexedDB}=fixture();
  const second=createAssistantMemoryRepository({indexedDB,now:fixedNow});
  const owners=await Promise.all([repo.getLocalOwnerId(),second.getLocalOwnerId(),repo.getLocalOwnerId()]);
  assert.match(owners[0],/^local-[a-f0-9-]+$/);assert.equal(new Set(owners).size,1);
  assert.equal(await createAssistantMemoryRepository({indexedDB,now:fixedNow}).getLocalOwnerId(),owners[0]);
  assert.notEqual(await fixture().repo.getLocalOwnerId(),owners[0]);
  assert.equal((await repo.read(other,'personal')).ownerId,other,'partition selection provides no authentication');
});

test('conversations, clarification and saved query survive refresh and isolate every owner and ledger',async()=>{
  const {repo,indexedDB}=fixture();const clarification={originalText:'昨天午饭',question:'花了多少元？'};
  let saved=await repo.appendConversation(owner,'personal',[message('u'),message('a',{role:'assistant',content:'本月餐饮支出35元',query:plan,clarification})],0,clarification);
  saved=await repo.upsertPreference(owner,'personal',rule(),saved.revision);
  assert.deepEqual(saved.clarification,clarification);
  assert.deepEqual(await createAssistantMemoryRepository({indexedDB,now:fixedNow}).read(owner,'personal'),saved);
  for(const kind of ['family','travel'])assert.deepEqual((await repo.read(owner,kind)).conversation,[]);
  assert.deepEqual((await repo.read(other,'personal')).preferences,[]);
  await repo.appendConversation(owner,'family',[message('u',{content:'家庭对话'})],0);
  assert.equal((await repo.read(owner,'personal')).conversation[0].content,'对话u');
  assert.equal((await repo.read(owner,'family')).conversation[0].content,'家庭对话');
  const copy=await repo.read(owner,'personal');copy.conversation[0].content='被外部改动';
  assert.equal((await repo.read(owner,'personal')).conversation[0].content,'对话u');
});

test('history beyond forty messages is retained while bad or duplicate new messages never partially save',async()=>{
  const {repo}=fixture();let saved=await repo.appendConversation(owner,'personal',Array.from({length:40},(_,i)=>message(`m${i}`)),0);
  saved=await repo.appendConversation(owner,'personal',[message('m40'),message('m41')],saved.revision);
  assert.equal(saved.conversation.length,42);assert.equal(saved.conversation[0].id,'m0');
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
  const {repo,indexedDB}=fixture();const second=createAssistantMemoryRepository({indexedDB,now:fixedNow});
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
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-assistant-memory-db');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const prototype=Object.getPrototypeOf(db.transaction('memory').objectStore('memory'));db.close();
  const original=prototype.put;
  try {
    prototype.put=function(){throw new DOMException('空间不足','QuotaExceededError');};
    await assert.rejects(repo.appendConversation(owner,'personal',[message('lost')],0),/空间不足/);
  } finally {prototype.put=original;}
  assert.equal((await repo.read(owner,'personal')).revision,0);assert.deepEqual((await repo.read(owner,'personal')).conversation,[]);
});

test('v1 IndexedDB upgrades without changing identity or history and blocks old version-one writers',async()=>{
  const indexedDB=new IDBFactory();
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-assistant-memory-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('memory');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const old={version:1,ownerId:owner,ledgerKind:'personal',revision:9,conversation:Array.from({length:40},(_,i)=>message(`old-${i}`)),preferences:[rule()],clarification:{originalText:'午饭',question:'金额？'}};
  await new Promise((resolve,reject)=>{const t=db.transaction('memory','readwrite');t.objectStore('memory').put(owner,'localOwnerId');t.objectStore('memory').put(old,JSON.stringify([owner,'personal']));t.oncomplete=resolve;t.onabort=()=>reject(t.error);});db.close();
  const repo=createAssistantMemoryRepository({indexedDB,now:fixedNow});assert.equal(await repo.getLocalOwnerId(),owner);
  const upgraded=await repo.read(owner,'personal');assert.equal(upgraded.version,2);assert.equal(upgraded.revision,10);assert.equal(upgraded.clarification,null,'legacy unproven pending raw text is cleared');
  assert.deepEqual(upgraded.conversation,old.conversation);assert.deepEqual(upgraded.preferences,old.preferences);assert.deepEqual(upgraded.companion,DEFAULT_COMPANION_PREFERENCES);
  const saved=await repo.appendConversation(owner,'personal',[message('next')],upgraded.revision);assert.equal(saved.conversation.length,41);
  await assert.rejects(new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-assistant-memory-db',1);r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);}),{name:'VersionError'});
  assert.deepEqual((await repo.read(owner,'personal')).conversation,saved.conversation);
});

test('companion preferences are scoped, durable, portable, and preserved by conversation-only clearing',async()=>{
  const {repo,indexedDB}=fixture(),prefs={tone:'gentle',remindersEnabled:false,dailyExpenseTarget:80.25,lunchReference:28.5,mutedUntil:'2026-11-01'};
  let saved=await repo.setCompanionPreferences(owner,'personal',prefs,0);prefs.tone='plain';
  assert.equal(saved.companion.tone,'gentle');assert.deepEqual((await createAssistantMemoryRepository({indexedDB,now:fixedNow}).read(owner,'personal')).companion,saved.companion);
  assert.deepEqual((await repo.read(owner,'family')).companion,DEFAULT_COMPANION_PREFERENCES);assert.deepEqual((await repo.read(other,'personal')).companion,DEFAULT_COMPANION_PREFERENCES);
  saved=await repo.appendConversation(owner,'personal',[message('u'),message('reminder',{role:'assistant',reminderId:'personal:daily:2026-10-24',replyTo:'u'})],saved.revision);
  const backup=await repo.exportOwner(owner);assert.equal(backup.version,2);
  const imported=await repo.importOwner(other,backup,{personal:0,family:0,travel:0});assert.deepEqual(imported.personal.companion,saved.companion);assert.equal(imported.personal.conversation[1].reminderId,'personal:daily:2026-10-24');
  const cleared=await repo.clearOwnerConversations(owner);assert.deepEqual(cleared.personal.companion,saved.companion);
  const full=await repo.clearOwner(owner);assert.deepEqual(full.personal.companion,DEFAULT_COMPANION_PREFERENCES);
  await assert.rejects(repo.setCompanionPreferences(owner,'personal',{...saved.companion,tone:'plain'},saved.revision),/其他页面更新/);
  for(const patch of [{tone:'unknown'},{remindersEnabled:'yes'},{dailyExpenseTarget:-1},{dailyExpenseTarget:1.001},{lunchReference:0},{mutedUntil:'2026-02-30'},{mutedUntil:'2026-10-24T00:00:00Z'},{extra:true}])await assert.rejects(repo.setCompanionPreferences(owner,'personal',{...DEFAULT_COMPANION_PREFERENCES,...patch},full.personal.revision),/无效/);
});

test('blocked v1 upgrade explains how to recover and closes its abandoned late connection',async()=>{
  const indexedDB=new IDBFactory();
  const old=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-assistant-memory-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('memory');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const repo=createAssistantMemoryRepository({indexedDB,now:fixedNow});
  await assert.rejects(repo.read(owner,'personal'),/关闭旧页面后重试/);
  old.close();
  // deleteDatabase queues after the abandoned upgrade. It must not be blocked
  // by a late onsuccess connection that was already reported as unsuccessful.
  await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('xiaoman-assistant-memory-db');r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('abandoned connection still open'));});
  assert.equal((await repo.read(owner,'personal')).version,2);
});

test('capacity is measured in bytes, refuses the whole save, and never trims recoverable history',async()=>{
  const {repo}=fixture();let saved=await repo.appendConversation(owner,'personal',[message('kept')],0);
  const large=Array.from({length:350},(_,i)=>message(`long-${i}`,{content:'字'.repeat(2000)}));
  assert.throws(()=>assertMemoryWriteCapacity(normalizeMemoryContents({conversation:large,preferences:[],clarification:null})),/空间不足.*导出/);
  await assert.rejects(repo.appendConversation(owner,'personal',large,saved.revision),/空间不足.*原有历史已保留/);
  assert.deepEqual(await repo.read(owner,'personal'),saved);assert.equal((await repo.exportOwner(owner)).ledgers.personal.conversation[0].id,'kept');
  await assert.rejects(repo.appendConversation(owner,'personal',[message('bad-reminder',{reminderId:'test'})],saved.revision));
});

test('complete multi-book history above the old 2 MB backup limit roundtrips and accepts legacy v1 backups',async()=>{
  const {repo}=fixture();
  for(const kind of kinds)await repo.appendConversation(owner,kind,Array.from({length:180},(_,i)=>message(`${kind}-${i}`,{content:'字'.repeat(1800)})),0);
  const backup=await repo.exportOwner(owner),bytes=new TextEncoder().encode(JSON.stringify(backup)).length;
  assert.ok(bytes>2_000_000&&bytes<MAX_MEMORY_BACKUP_BYTES);assert.equal(validateOwnerMemoryBackup(backup),true);
  const restored=await repo.importOwner(other,backup,{personal:0,family:0,travel:0});
  for(const kind of kinds){assert.equal(restored[kind].conversation.length,180);assert.equal(restored[kind].conversation[0].id,`${kind}-0`);}
  const legacy={app:'xiaoman-assistant-memory',version:1,exportedAt:'2026-10-24T12:00:00.000Z',ledgers:Object.fromEntries(kinds.map(kind=>[kind,{conversation:[message(`legacy-${kind}`)],preferences:[rule()],clarification:null}]))};
  assert.equal(validateOwnerMemoryBackup(legacy),true);
  const imported=await repo.importOwner(other,legacy,revisions(restored));assert.equal(imported.personal.version,2);assert.deepEqual(imported.personal.companion,DEFAULT_COMPANION_PREFERENCES);assert.equal(imported.personal.conversation[0].id,'legacy-personal');
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

async function rawRead(indexedDB,key) {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-assistant-memory-db');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('memory','readonly');let result;const request=tx.objectStore('memory').get(key);request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
const retentionContents=(conversation,extra={})=>normalizeMemoryContents({version:2,conversation,preferences:[rule()],clarification:{originalText:'旧的待补充原文',question:'还差金额？'},companion:{...DEFAULT_COMPANION_PREFERENCES,tone:'gentle',dailyExpenseTarget:60,lunchReference:14},...extra});
const retentionState=(kind,conversation,extra={})=>({ownerId:owner,ledgerKind:kind,revision:4,...retentionContents(conversation),...extra});

test('90-day retention is an exact UTC instant, removes expired embedded context and dangling replies, and never mutates preferences',()=>{
  assert.equal(CONVERSATION_RETENTION_DAYS,90);
  const input=retentionContents([
    message('old',{role:'assistant',createdAt:expiredAt,query:plan,clarification:{originalText:'到期原文',question:'金额？'}}),
    message('boundary',{createdAt:cutoff}),
    message('reply',{role:'assistant',replyTo:'old'}),
    message('valid-reply',{role:'assistant',replyTo:'boundary'}),
    message('orphan',{role:'assistant',replyTo:'missing'}),
    message('future',{createdAt:'2027-01-01T00:00:00.000Z'}),
  ]), before=structuredClone(input);
  const result=pruneExpiredMemoryContents(input,fixedNow());
  assert.equal(result.changed,true);
  assert.deepEqual(result.contents.conversation.map(item=>item.id),['boundary','reply','valid-reply','orphan','future']);
  assert.equal(result.contents.conversation[1].replyTo,undefined);
  assert.equal(result.contents.conversation[2].replyTo,'boundary');
  assert.equal(result.contents.conversation[3].replyTo,undefined);
  assert.equal(result.contents.clarification,null);
  assert.deepEqual(result.contents.preferences,before.preferences);
  assert.deepEqual(result.contents.companion,before.companion);
  assert.deepEqual(input,before);
  assert.equal(pruneExpiredMemoryContents(result.contents,fixedNow()).changed,false);
  assert.throws(()=>pruneExpiredMemoryContents(input,new Date('bad')));
  const orphanOnly=retentionContents([message('orphan',{role:'assistant',replyTo:'missing'})]);
  assert.equal(pruneExpiredMemoryContents(orphanOnly,fixedNow()).contents.clarification,null,'an untimestamped pending question requires a retained source');
});

test('local read aliases physically prune once, preserve preferences, and stale writers cannot restore expired content',async()=>{
  for(const method of ['read','getConversation','getPreferences']) {
    const {repo,indexedDB}=fixture();await repo.read(owner,'personal');
    const key=JSON.stringify([owner,'personal']), stored=retentionState('personal',[message('old',{createdAt:expiredAt}),message('boundary',{createdAt:cutoff})]);
    await rawWrite(indexedDB,key,stored);
    const result=await repo[method](owner,'personal');
    assert.equal(result.revision,5);assert.deepEqual(result.conversation.map(item=>item.id),['boundary']);
    assert.equal(result.clarification,null);assert.deepEqual(result.preferences,stored.preferences);assert.deepEqual(result.companion,stored.companion);
    assert.deepEqual(await rawRead(indexedDB,key),result,'expired originals are deleted from IndexedDB');
    assert.deepEqual(await repo[method](owner,'personal'),result,'no revision changes when nothing expired');
    await assert.rejects(repo.replaceConversation(owner,'personal',stored.conversation,4),/更新/);
    assert.deepEqual(await rawRead(indexedDB,key),result);
  }
});

test('local readOwner and export clean every owned book atomically without writing empty books or other owners',async()=>{
  let instant=fixedNow();const {repo,indexedDB}=fixture(()=>instant);await repo.read(owner,'personal');
  const personal=retentionState('personal',[message('old',{createdAt:expiredAt}),message('boundary',{createdAt:cutoff})]);
  const family=retentionState('family',[message('recent')],{clarification:null});
  const otherState={...personal,ownerId:other};
  await rawWrite(indexedDB,JSON.stringify([owner,'personal']),personal);
  await rawWrite(indexedDB,JSON.stringify([owner,'family']),family);
  await rawWrite(indexedDB,JSON.stringify([other,'personal']),otherState);
  const all=await repo.readOwner(owner);
  assert.deepEqual(revisions(all),{personal:5,family:4,travel:0});
  assert.equal(await rawRead(indexedDB,JSON.stringify([owner,'travel'])),undefined);
  assert.deepEqual(await rawRead(indexedDB,JSON.stringify([other,'personal'])),otherState);
  instant=new Date(instant.getTime()+1);
  const backup=await repo.exportOwner(owner);
  assert.deepEqual(backup.ledgers.personal.conversation,[]);
  assert.deepEqual(backup.ledgers.family.conversation,family.conversation);
  assert.equal((await rawRead(indexedDB,JSON.stringify([owner,'personal']))).revision,6);
  assert.equal((await rawRead(indexedDB,JSON.stringify([owner,'family']))).revision,4);
  assert.deepEqual(backup.ledgers.personal.preferences,personal.preferences);
  assert.deepEqual(backup.ledgers.personal.companion,personal.companion);
});

test('local write prunes against the original expected revision in the same commit and cannot import expired raw text',async()=>{
  const {repo,indexedDB}=fixture();await repo.read(owner,'personal');
  const key=JSON.stringify([owner,'personal']);
  await rawWrite(indexedDB,key,retentionState('personal',[message('expired',{createdAt:expiredAt})]));
  const appended=await repo.appendConversation(owner,'personal',[message('fresh'),message('incoming-old',{createdAt:expiredAt})],4,{originalText:'旧原文',question:'金额？'});
  assert.equal(appended.revision,5,'cleanup does not create a self-conflict or a second revision');
  assert.deepEqual(appended.conversation.map(item=>item.id),['fresh']);assert.equal(appended.clarification,null);
  const replaced=await repo.replaceConversation(owner,'personal',[message('old-replacement',{createdAt:expiredAt}),message('boundary',{createdAt:cutoff})],5,{originalText:'旧原文',question:'金额？'});
  assert.equal(replaced.revision,6);assert.deepEqual(replaced.conversation.map(item=>item.id),['boundary']);assert.equal(replaced.clarification,null);
  const all=await repo.readOwner(owner);
  const backup={app:'xiaoman-assistant-memory',version:2,exportedAt:fixedNow().toISOString(),ledgers:Object.fromEntries(kinds.map(kind=>[kind,retentionContents([message(`${kind}-old`,{createdAt:expiredAt}),message(`${kind}-boundary`,{createdAt:cutoff})])]))};
  const imported=await repo.importOwner(owner,backup,revisions(all));
  for(const kind of kinds) {
    assert.equal(imported[kind].revision,all[kind].revision+1);
    assert.deepEqual(imported[kind].conversation.map(item=>item.id),[`${kind}-boundary`]);assert.equal(imported[kind].clarification,null);
    assert.deepEqual(imported[kind].preferences,backup.ledgers[kind].preferences);assert.deepEqual(imported[kind].companion,backup.ledgers[kind].companion);
    assert.deepEqual(await rawRead(indexedDB,JSON.stringify([owner,kind])),imported[kind]);
  }
});

test('failed local mutations and stale multi-book imports roll back cleanup as well as writes',async()=>{
  const {repo,indexedDB}=fixture();await repo.read(owner,'personal');
  const key=JSON.stringify([owner,'personal']), stored=retentionState('personal',[message('old',{createdAt:expiredAt})]);
  await rawWrite(indexedDB,key,stored);
  await assert.rejects(repo.deletePreference(owner,'personal','missing',4),/不存在/);
  assert.deepEqual(await rawRead(indexedDB,key),stored,'failed business change cannot return success or partially prune');
  const backup={app:'xiaoman-assistant-memory',version:2,exportedAt:fixedNow().toISOString(),ledgers:Object.fromEntries(kinds.map(kind=>[kind,retentionContents([message(`${kind}-new`)])]))};
  await assert.rejects(repo.importOwner(owner,backup,{personal:4,family:99,travel:0}),/更新/);
  assert.deepEqual(await rawRead(indexedDB,key),stored);
  assert.equal(await rawRead(indexedDB,JSON.stringify([owner,'family'])),undefined);
  assert.equal((await repo.read(owner,'personal')).revision,5,'the next successful read still cleans expired content');
});

test('concurrent local cleanup and append either serialize one CAS write or reject the stale writer without resurrecting history',async()=>{
  const {repo,indexedDB}=fixture();await repo.read(owner,'personal');
  await rawWrite(indexedDB,JSON.stringify([owner,'personal']),retentionState('personal',[message('old',{createdAt:expiredAt})]));
  const second=createAssistantMemoryRepository({indexedDB,now:fixedNow});
  const [reading,writing]=await Promise.allSettled([repo.read(owner,'personal'),second.appendConversation(owner,'personal',[message('new')],4)]);
  assert.equal(reading.status,'fulfilled');
  const saved=await repo.read(owner,'personal');
  assert.equal(saved.revision,5);assert.ok(saved.conversation.every(item=>item.id!=='old'));
  if(writing.status==='fulfilled')assert.deepEqual(saved.conversation.map(item=>item.id),['new']);
  else {assert.match(writing.reason.message,/更新/);assert.deepEqual(saved.conversation,[]);}
});

test('pending clarification requires an exact retained assistant source, not a reused generic question',()=>{
  const pending={originalText:'昨天和朋友吃饭',question:'花了多少元？'};
  const source=message('source',{role:'assistant',createdAt:cutoff,clarification:pending});
  const valid=retentionContents([message('unrelated-old',{createdAt:expiredAt}),source],{clarification:pending});
  const pruned=pruneExpiredMemoryContents(valid,fixedNow());
  assert.deepEqual(pruned.contents.clarification,pending,'unrelated expiry does not erase a still-valid follow-up');
  assert.deepEqual(pruned.contents.conversation.map(item=>item.id),['source']);
  assert.equal(pruneExpiredMemoryContents(pruned.contents,fixedNow()).changed,false);
  for(const conversation of [[],[message('recent')],[{...source,createdAt:expiredAt}],
    [{...source,clarification:{...pending,originalText:'另一笔支出'}}],
    [{...source,clarification:{...pending,question:'哪一天？'}}],
    [{...source,createdAt:expiredAt},message('generic',{role:'assistant',clarification:{originalText:'另一笔支出',question:pending.question}})]]) {
    const input=retentionContents(conversation,{clarification:pending}),result=pruneExpiredMemoryContents(input,fixedNow());
    assert.equal(result.contents.clarification,null);assert.equal(result.changed,true);
    assert.deepEqual(result.contents.preferences,input.preferences);assert.deepEqual(result.contents.companion,input.companion);
  }
});

test('local cleanup removes unproven top-level raw text physically even with an empty conversation',async()=>{
  const {repo,indexedDB}=fixture();await repo.read(owner,'personal');
  const key=JSON.stringify([owner,'personal']),stored=retentionState('personal',[]);
  await rawWrite(indexedDB,key,stored);
  const cleaned=await repo.read(owner,'personal');
  assert.equal(cleaned.revision,5);assert.equal(cleaned.clarification,null);assert.deepEqual(cleaned.conversation,[]);
  assert.deepEqual(await rawRead(indexedDB,key),cleaned);assert.equal((await repo.read(owner,'personal')).revision,5);
  const backup={app:'xiaoman-assistant-memory',version:2,exportedAt:fixedNow().toISOString(),ledgers:Object.fromEntries(kinds.map(kind=>[kind,retentionContents([])]))};
  const imported=await repo.importOwner(owner,backup,revisions(await repo.readOwner(owner)));
  for(const kind of kinds)assert.equal(imported[kind].clarification,null,'an old backup cannot restore raw text without a source');
  const exported=await repo.exportOwner(owner);
  for(const kind of kinds)assert.equal(exported.ledgers[kind].clarification,null);
});

test('local append replacement and import retain a valid new clarification while unrelated old messages expire',async()=>{
  const pending={originalText:'今天午饭',question:'多少钱？'},source=message('source',{role:'assistant',clarification:pending});
  for(const method of ['appendConversation','replaceConversation']) {
    const {repo,indexedDB}=fixture();await repo.read(owner,'personal');
    await rawWrite(indexedDB,JSON.stringify([owner,'personal']),retentionState('personal',[message('old',{createdAt:expiredAt})]));
    const saved=await repo[method](owner,'personal',[source],4,pending);
    assert.equal(saved.revision,5);assert.deepEqual(saved.clarification,pending);assert.deepEqual(saved.conversation,[source]);
  }
  const {repo,indexedDB}=fixture();await repo.read(owner,'personal');
  for(const kind of kinds)await rawWrite(indexedDB,JSON.stringify([owner,kind]),retentionState(kind,[message(`${kind}-old`,{createdAt:expiredAt})]));
  const backup={app:'xiaoman-assistant-memory',version:2,exportedAt:fixedNow().toISOString(),ledgers:Object.fromEntries(kinds.map(kind=>[kind,retentionContents([source],{clarification:pending})]))};
  const saved=await repo.importOwner(owner,backup,{personal:4,family:4,travel:4});
  for(const kind of kinds){assert.equal(saved[kind].revision,5);assert.deepEqual(saved[kind].clarification,pending);}
});
