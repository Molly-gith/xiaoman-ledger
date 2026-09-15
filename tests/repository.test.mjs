import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { defaultState, normalizeBackup } from '../lib/data/schema.ts';
import { createRepository } from '../lib/data/repository.ts';
import { createLocalStore } from '../lib/data/local-adapter.ts';
import { salaryCycle, calculateFinance } from '../lib/domain/finance.ts';
const cycle=salaryCycle('2026-09-15',20);
const plan={cycleId:cycle.id,availableIncome:10000,plannedSavings:2000,necessaryReserve:3000};
const tx=(extra={})=>({id:'a',type:'expense',amount:100,date:'2026-09-15',cycleId:cycle.id,nature:'消费',spendKind:'variable',category:'餐饮',note:'午饭',icon:'餐',source:'text',...extra});
function memoryStore() {
  let value=defaultState();
  return {read:async()=>structuredClone(value),commit:async(next,revision)=>{if(value.revision!==revision) throw Error('stale');value=structuredClone(next);}};
}
function browser() {
  const map=new Map();
  globalThis.indexedDB=new IDBFactory();
  globalThis.localStorage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name,fn)=>fn()}}});
  return map;
}
test('repository persists first cycle and manual CRUD with exact recalculation',async()=>{
  const repo=createRepository(memoryStore());
  let state=await repo.saveCycle(cycle,plan,0);
  state=await repo.saveTransaction(tx(),state.revision);
  state=await repo.saveTransaction(tx({amount:350,nature:'投资',category:'学习'}),state.revision,true);
  assert.equal(calculateFinance(cycle,plan,state.transactions).safeToSpend,4650);
  assert.equal((await repo.read()).transactions[0].nature,'投资');
  state=await repo.deleteTransaction('a',state.revision);
  assert.equal(calculateFinance(cycle,plan,state.transactions).safeToSpend,5000);
});
test('rejects duplicate IDs, invalid cycle/date, missing subjective choice and stale writes',async()=>{
  const repo=createRepository(memoryStore());await repo.saveCycle(cycle,plan,0);
  await assert.rejects(repo.saveTransaction(tx(),0),/其他页面/);
  await assert.rejects(repo.saveTransaction(tx({nature:null}),1),/确认/);
  await assert.rejects(repo.saveTransaction(tx({date:'2026-09-21'}),1),/日期/);
  await repo.saveTransaction(tx(),1);
  await assert.rejects(repo.saveTransaction(tx(),2),/重复/);
  await assert.rejects(repo.saveTransaction(tx({id:'missing'}),2,true),/不存在/);
});
test('reserve overspend and reducing reserve below recorded usage leave state unchanged',async()=>{
  const repo=createRepository(memoryStore());await repo.saveCycle(cycle,plan,0);
  await assert.rejects(repo.saveTransaction(tx({spendKind:'reserved',amount:3100}),1),/预留额度不足/);
  const s=await repo.saveTransaction(tx({spendKind:'reserved',amount:2800}),1);
  await assert.rejects(repo.saveCycle(cycle,{...plan,necessaryReserve:2700},s.revision),/预留额度不足/);
  assert.equal((await repo.read()).budgets[0].necessaryReserve,3000);
});
test('failed persistence does not mutate saved data',async()=>{
  const store=memoryStore(), repo=createRepository(store);await repo.saveCycle(cycle,plan,0);
  store.commit=async()=>{throw Error('quota');};
  await assert.rejects(repo.saveTransaction(tx(),1),/quota/);
  assert.equal((await repo.read()).transactions.length,0);
});
test('v1 backups migrate losslessly without inventing nature or allocation',()=>{
  const legacy={...defaultState(),version:1,transactions:[tx()]};
  const s=normalizeBackup(legacy);assert.equal(s.transactions.length,1);assert.equal(s.transactions[0].nature,null);assert.equal(s.transactions[0].cycleId,null);
  assert.deepEqual(normalizeBackup(JSON.parse(JSON.stringify(s))),s);
  assert.throws(()=>normalizeBackup({...s,version:99}));
  assert.throws(()=>normalizeBackup({...s,transactions:[tx(),tx()]}));
});
test('import preserves separate AI recommendation and final user nature',async()=>{
  const repo=createRepository(memoryStore());await repo.saveCycle(cycle,plan,0);
  const suggestion={nature:'浪费',confidence:0.7,reason:'test',modelVersion:'stub',promptVersion:'v1'};
  const state=await repo.saveTransaction(tx({nature:'投资',aiSuggestion:suggestion}),1);
  const restored=normalizeBackup(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.transactions[0].nature,'投资');assert.deepEqual(restored.transactions[0].aiSuggestion,suggestion);
});
test('IndexedDB durability and revision guard work across repository instances',async()=>{
  browser();const a=createRepository(createLocalStore()),b=createRepository(createLocalStore());
  await a.read();await b.read();await a.saveCycle(cycle,plan,0);
  await assert.rejects(b.saveCycle(cycle,plan,0),/其他页面/);
  await a.saveTransaction(tx(),1);
  assert.equal((await createRepository(createLocalStore()).read()).transactions[0].amount,100);
});
test('corrupt fallback is rejected without writing or clearing it',async()=>{
  const map=browser();map.set('xiaoman-ledger-local-v1','{broken');
  await assert.rejects(createRepository(createLocalStore()).read());
  assert.equal(map.get('xiaoman-ledger-local-v1'),'{broken');
});
test('fallback remains authoritative when IndexedDB becomes available again',async()=>{
  const map=browser();const old=createRepository(createLocalStore());await old.read();await old.saveCycle(cycle,plan,0);
  const fallback={...defaultState(),revision:10};map.set('xiaoman-ledger-local-v1',JSON.stringify(fallback));
  const repo=createRepository(createLocalStore());assert.equal((await repo.read()).revision,10);
  await repo.saveCycle(cycle,{...plan,availableIncome:9000},10);
  assert.equal((await createRepository(createLocalStore()).read()).budgets[0].availableIncome,9000);
});
test('legacy localStorage records are preserved when IDB is empty',async()=>{
  const map=browser();map.set('xiaoman-ledger',JSON.stringify({transactions:[tx({id:'1'})],budget:100,saved:0,goal:1000}));
  const repo=createRepository(createLocalStore());const state=await repo.read();
  assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].id,'1');
});
