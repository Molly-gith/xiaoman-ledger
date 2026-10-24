import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { defaultState, defaultLedgerData, ledgerDataOf, encodeBackup, normalizeBackup } from '../lib/data/schema.ts';
import { createRepository } from '../lib/data/repository.ts';
import { createLocalStore } from '../lib/data/local-adapter.ts';
import { calendarMonthCycle, customCycle, salaryCycle, calculateFinance } from '../lib/domain/finance.ts';
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
test('default calendar month persists once and allows spending before any budget is configured',async()=>{
  const repo=createRepository(memoryStore());
  const fresh=await repo.ensureCurrentCycle('2026-10-10');
  const month=calendarMonthCycle('2026-10-10');
  assert.equal(fresh.activeCycleId,month.id);
  assert.deepEqual(fresh.cycles,[month]);
  assert.equal(fresh.budgets[0].availableIncome,null);
  assert.equal(fresh.budgets[0].plannedSavings,null);
  assert.equal(fresh.profile,null);
  assert.deepEqual(await repo.ensureCurrentCycle('2026-10-31'),fresh);
  const saved=await repo.saveTransaction(tx({cycleId:month.id,date:'2026-10-10',amount:268}),fresh.revision);
  assert.equal(calculateFinance(month,saved.budgets[0],saved.transactions).safeToSpend,null);
  assert.equal(saved.transactions[0].amount,268);
  assert.deepEqual(normalizeBackup(JSON.parse(JSON.stringify(saved))),saved);
});
test('v4 budgets preserve null while legacy numeric unknown flags still migrate without changing real zero',async()=>{
  const repo=createRepository(memoryStore());let state=await repo.ensureCurrentCycle('2026-10-10');
  state=await repo.saveTransaction(tx({cycleId:state.activeCycleId,date:'2026-10-10'}),state.revision);
  const backup=JSON.parse(JSON.stringify(encodeBackup(state)));
  assert.equal(backup.version,4);
  assert.equal(backup.budgets[0].availableIncome,null);
  assert.equal(backup.budgets[0].plannedSavings,null);
  assert.deepEqual(normalizeBackup(backup),state);
  const legacyView={...structuredClone(backup),version:3};delete legacyView.otherLedgers;
  legacyView.budgets[0]={...legacyView.budgets[0],availableIncome:0,availableIncomeKnown:false,plannedSavings:0,plannedSavingsKnown:false};
  assert.deepEqual(normalizeBackup(legacyView),state);
  state=await repo.saveCycle(state.cycles[0],{...state.budgets[0],availableIncome:0,plannedSavings:2500},state.revision);
  const known=encodeBackup(state);
  assert.equal(known.budgets[0].availableIncomeKnown,undefined);
  assert.equal(known.budgets[0].plannedSavings,2500);
  assert.deepEqual(normalizeBackup(known),state);
  const invalid=structuredClone(known);invalid.budgets[0].plannedSavingsKnown=false;
  assert.throws(()=>normalizeBackup(invalid),/兼容字段/);
});
test('IndexedDB and fallback persist v4 nullable amounts and the entire multi-ledger state',async()=>{
  const map=browser();const repo=createRepository(createLocalStore());
  const first=await repo.ensureCurrentCycle('2026-10-10');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-ledger-db');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const raw=await new Promise((resolve,reject)=>{const t=db.transaction('ledger','readonly'),r=t.objectStore('ledger').get('current');t.oncomplete=()=>resolve(r.result);t.onabort=()=>reject(t.error);});db.close();
  assert.equal(raw.version,4);
  assert.equal(raw.budgets[0].availableIncome,null);
  assert.deepEqual(Object.keys(raw.otherLedgers).sort(),['family','travel']);
  assert.deepEqual(await createRepository(createLocalStore()).read(),first);
  map.set('xiaoman-ledger-local-v1',JSON.stringify({...raw,revision:10}));
  const fallback=createRepository(createLocalStore());
  const next=await fallback.ensureCurrentCycle('2026-11-01');
  const stored=JSON.parse(map.get('xiaoman-ledger-local-v1'));
  assert.equal(stored.budgets[1].availableIncome,null);
  assert.equal(stored.budgets[1].plannedSavings,null);
  assert.deepEqual(await createRepository(createLocalStore()).read(),next);
});
test('calendar rollover preserves all history and resets both optional amounts without copying funds',async()=>{
  const repo=createRepository(memoryStore());
  let state=await repo.ensureCurrentCycle('2026-09-30');
  const prior=state.cycles[0];
  state=await repo.saveCycle(prior,{...state.budgets[0],availableIncome:10000,plannedSavings:2500},state.revision);
  state=await repo.saveTransaction(tx({cycleId:prior.id,date:'2026-09-30'}),state.revision);
  const next=await repo.ensureCurrentCycle('2026-10-01');
  assert.equal(next.cycles.length,2);
  assert.deepEqual(next.cycles[0],prior);
  assert.deepEqual(next.transactions,state.transactions);
  assert.deepEqual(next.budgets[0],state.budgets[0]);
  assert.equal(next.budgets[1].availableIncome,null);
  assert.equal(next.budgets[1].plannedSavings,null);
  assert.deepEqual(await repo.ensureCurrentCycle('2026-10-10'),next);
  assert.deepEqual(await repo.ensureCurrentCycle('2026-09-15'),next,'clock moving backward cannot rewrite the active month');
});
test('automatic month creation is safe across simultaneous tabs and never hides persistence failure',async()=>{
  const store=memoryStore(),a=createRepository(store),b=createRepository(store);
  const [first,second]=await Promise.all([a.ensureCurrentCycle('2026-10-10'),b.ensureCurrentCycle('2026-10-10')]);
  assert.deepEqual(first,second);
  assert.equal(first.revision,1);
  assert.equal((await a.read()).cycles.length,1);
  const failed=memoryStore();failed.commit=async()=>{throw Error('quota');};
  await assert.rejects(createRepository(failed).ensureCurrentCycle('2026-10-10'),/quota/);
  assert.equal((await failed.read()).cycles.length,0);
});
test('automatic defaults leave salary/custom settings and migrated legacy transactions untouched',async()=>{
  for(const prior of [cycle,customCycle('2026-08-01','2026-08-10')]) {
    const repo=createRepository(memoryStore());
    const state=await repo.saveCycle(prior,{...plan,cycleId:prior.id},0);
    assert.deepEqual(await repo.ensureCurrentCycle('2026-10-10'),state);
  }
  const repo=createRepository(memoryStore());
  const imported=normalizeBackup({...defaultState(),version:1,transactions:[tx()]});
  const state=await repo.replace(imported,0);
  const initialized=await repo.ensureCurrentCycle('2026-10-10');
  assert.deepEqual(initialized.transactions,state.transactions);
  assert.equal(initialized.transactions[0].cycleId,null);
  assert.equal(initialized.transactions[0].nature,null);
});
test('a reused existing month keeps its saved budget while overlapping historical periods are preserved',async()=>{
  const repo=createRepository(memoryStore());
  const prior=await repo.ensureCurrentCycle('2026-09-30');
  const current=calendarMonthCycle('2026-10-10');
  const existing=await repo.saveCycle(current,{...plan,cycleId:current.id,model:'nature',necessaryReserve:0},prior.revision);
  const oldActive={...existing,activeCycleId:prior.activeCycleId};
  await repo.replace(oldActive,existing.revision);
  const reused=await repo.ensureCurrentCycle('2026-10-10');
  assert.equal(reused.activeCycleId,current.id);
  assert.equal(reused.cycles.length,2);
  assert.deepEqual(reused.budgets,existing.budgets);
  const blocked=createRepository(memoryStore());
  const september=await blocked.ensureCurrentCycle('2026-09-30');
  const custom=customCycle('2026-10-01','2026-10-15');
  const withCustom=await blocked.saveCycle(custom,{...plan,cycleId:custom.id},september.revision);
  const unchanged=await blocked.replace({...withCustom,activeCycleId:september.activeCycleId},withCustom.revision);
  assert.deepEqual(await blocked.ensureCurrentCycle('2026-10-10'),unchanged);
});
test('explicit cycle replacement moves only current record affiliations while preserving all ledger details',async()=>{
  const repo=createRepository(memoryStore());
  let state=await repo.ensureCurrentCycle('2026-09-30');
  state=await repo.saveTransaction(tx({id:'history',cycleId:state.activeCycleId,date:'2026-09-30'}),state.revision);
  state=await repo.ensureCurrentCycle('2026-10-10');
  const oldId=state.activeCycleId;
  state=await repo.saveTransaction(tx({cycleId:oldId,date:'2026-10-10',note:'保留原备注',amount:268}),state.revision);
  state=await repo.saveTransaction(tx({id:'income',cycleId:oldId,date:'2026-10-11',type:'income',nature:null,spendKind:null,amount:2000}),state.revision);
  state=await repo.saveInvestmentAccount({id:'fund',name:'基金',openingNetContribution:null,currentMarketValue:500,marketValueUpdatedAt:'2026-10-10',createdAt:'2026-10-10'},state.revision);
  state=await repo.saveInvestmentFlow({id:'flow',accountId:'fund',type:'contribution',amount:100,date:'2026-10-15',cycleId:oldId},state.revision);
  state=await repo.saveInvestmentFlow({id:'unassigned',accountId:'fund',type:'withdrawal',amount:50,date:'2026-10-16',cycleId:null},state.revision);
  const salary=salaryCycle('2026-10-10',5),newPlan={...state.budgets.find(item=>item.cycleId===oldId),cycleId:salary.id,availableIncome:10000};
  const replaced=await repo.replaceCurrentCycle(salary,newPlan,state.revision);
  assert.equal(replaced.activeCycleId,salary.id);
  assert.equal(replaced.profile.salaryDay,5);
  assert.deepEqual(replaced.cycles,[state.cycles[0],salary]);
  assert.deepEqual(replaced.budgets,[state.budgets[0],newPlan]);
  assert.deepEqual(replaced.transactions,state.transactions.map(item=>item.cycleId===oldId?{...item,cycleId:salary.id}:item));
  assert.deepEqual(replaced.investmentFlows,state.investmentFlows.map(item=>item.cycleId===oldId?{...item,cycleId:salary.id}:item));
  assert.deepEqual(replaced.investmentAccounts,state.investmentAccounts);
  assert.deepEqual(replaced.marketValueSnapshots,state.marketValueSnapshots);
  assert.equal(replaced.revision,state.revision+1);
});
test('cycle replacement rejects out-of-range expenses or investment flows without changing any saved data',async()=>{
  for(const populate of ['transaction','flow']) {
    const other=createRepository(memoryStore());let original=await other.ensureCurrentCycle('2026-10-10');
    const month=original.cycles[0];
    if(populate==='transaction') original=await other.saveTransaction(tx({cycleId:month.id,date:'2026-10-10'}),original.revision);
    else {
      original=await other.saveInvestmentAccount({id:'fund',name:'基金',openingNetContribution:0,currentMarketValue:0,marketValueUpdatedAt:'2026-10-10',createdAt:'2026-10-10'},original.revision);
      original=await other.saveInvestmentFlow({id:'flow',accountId:'fund',type:'contribution',amount:100,date:'2026-10-10',cycleId:month.id},original.revision);
    }
    const tooShort=customCycle('2026-10-11','2026-10-31');
    await assert.rejects(other.replaceCurrentCycle(tooShort,{...original.budgets[0],cycleId:tooShort.id},original.revision),/不属于所选周期/);
    assert.deepEqual(await other.read(),original);
  }
});
test('cycle replacement cannot overlap history, overwrite another cycle, bypass canonical IDs or ignore stale writes',async()=>{
  const repo=createRepository(memoryStore());
  await repo.ensureCurrentCycle('2026-09-30');
  const original=await repo.ensureCurrentCycle('2026-10-10');
  const overlap=customCycle('2026-09-30','2026-10-31'),current=original.cycles[1],budget=original.budgets[1];
  await assert.rejects(repo.replaceCurrentCycle(overlap,{...budget,cycleId:overlap.id},original.revision),/重叠/);
  await assert.rejects(repo.replaceCurrentCycle(original.cycles[0],{...budget,cycleId:original.cycles[0].id},original.revision),/重叠/);
  await assert.rejects(repo.replaceCurrentCycle({...current,id:'invented-id'},{...budget,cycleId:'invented-id'},original.revision),/日期不一致/);
  await assert.rejects(repo.replaceCurrentCycle(current,budget,original.revision-1),/其他页面/);
  assert.deepEqual(await repo.read(),original);
});
test('legacy timestamps must be confirmed before changing cycle dates or mode, but budget-only edits remain allowed',async()=>{
  const repo=createRepository(memoryStore());let state=await repo.ensureCurrentCycle('2026-10-10');
  state=await repo.replace({...state,transactions:[tx({cycleId:state.activeCycleId,date:'2026-10-09T16:30:00Z'})]},state.revision);
  const next=salaryCycle('2026-10-10',1);
  await assert.rejects(repo.replaceCurrentCycle(next,{...state.budgets[0],cycleId:next.id},state.revision),/旧账日期待核对/);
  assert.deepEqual(await repo.read(),state);
  state=await repo.replaceCurrentCycle(state.cycles[0],{...state.budgets[0],availableIncome:1000},state.revision);
  assert.equal(state.transactions[0].dateNeedsConfirmation,true);
  state=await repo.saveTransaction({...state.transactions[0],date:'2026-10-10'},state.revision,true);
  const replaced=await repo.replaceCurrentCycle(next,{...state.budgets[0],cycleId:next.id},state.revision);
  assert.equal(replaced.transactions[0].cycleId,next.id);
  assert.equal(replaced.transactions[0].date,'2026-10-10');
});
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
test('V6 funding sources round-trip without changing the deterministic available-funds total',async()=>{
  const repo=createRepository(memoryStore());
  const v6Plan={...plan,model:'nature',necessaryReserve:0,plannedSavings:2500,fundingSources:[
    {id:'salary',type:'salary',amount:8000},{id:'side',type:'freelance',amount:2000}
  ]};
  const state=await repo.saveCycle(cycle,v6Plan,0);
  assert.equal(state.budgets[0].fundingSources.length,2);
  assert.equal(state.budgets[0].availableIncome,10000);
  assert.equal(calculateFinance(state.cycles[0],state.budgets[0],[]).safeToSpend,7500);
  const restored=normalizeBackup(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.budgets[0].fundingSources,state.budgets[0].fundingSources);
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
test('temporary IndexedDB open failures cannot bootstrap an empty ledger',async()=>{
  const map=browser(), repo=createRepository(createLocalStore());
  await repo.saveCycle(cycle,plan,0);await repo.saveTransaction(tx(),1);
  const database=globalThis.indexedDB;
  globalThis.indexedDB={open(){throw Error('temporary database failure');}};
  await assert.rejects(createRepository(createLocalStore()).read(),/数据库暂时无法打开/);
  await assert.rejects(createRepository(createLocalStore()).saveCycle(cycle,plan,0),/数据库暂时无法打开/);
  assert.equal(map.has('xiaoman-ledger-local-v1'),false);
  globalThis.indexedDB=database;
  assert.equal((await createRepository(createLocalStore()).read()).transactions.length,1);
});
test('v1 upgrade preserves original IDB-first authority without deleting stale fallback',async()=>{
  const map=browser(), store=createLocalStore();await store.read();
  const legacy={...defaultState(),version:1,transactions:[tx(),tx({id:'b',amount:200})]};
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-ledger-db');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const t=db.transaction('ledger','readwrite');t.objectStore('ledger').put(legacy,'current');t.oncomplete=resolve;t.onabort=()=>reject(t.error);});db.close();
  const fallback=JSON.stringify({...legacy,transactions:[tx()]});map.set('xiaoman-ledger-local-v1',fallback);
  const repo=createRepository(createLocalStore());assert.equal((await repo.read()).transactions.length,2);
  const next=await repo.saveCycle(cycle,plan,0);assert.equal(next.transactions.length,2);
  assert.equal((await createRepository(createLocalStore()).read()).transactions.length,2);
  assert.equal(map.get('xiaoman-ledger-local-v1'),fallback);
});
test('malformed stale fallback cannot shadow a valid IndexedDB ledger',async()=>{
  const map=browser(), repo=createRepository(createLocalStore());await repo.saveCycle(cycle,plan,0);
  map.set('xiaoman-ledger-local-v1','{broken');
  const fresh=createRepository(createLocalStore());assert.equal((await fresh.read()).cycles.length,1);
  await fresh.saveTransaction(tx(),1);assert.equal((await fresh.read()).transactions.length,1);
});
test('legacy timestamps remain readable across timezones until date is explicitly confirmed',async()=>{
  const prior=process.env.TZ;
  try {
    process.env.TZ='Asia/Hong_Kong';
    const c=salaryCycle('2026-09-20',20), p={...plan,cycleId:c.id};
    const store=memoryStore();
    const old={...defaultState(),revision:1,profile:{salaryDay:20},activeCycleId:c.id,cycles:[c],budgets:[p],transactions:[tx({cycleId:c.id,date:'2026-09-19T16:30:00Z'})]};
    await store.commit(old,0);
    process.env.TZ='UTC';const repo=createRepository(store), state=await repo.read();
    assert.equal(state.transactions[0].date,'2026-09-19T16:30:00Z');
    assert.equal(state.transactions[0].dateNeedsConfirmation,true);
    assert.equal(calculateFinance(c,p,state.transactions).unresolvedCount,1);
    assert.equal(calculateFinance(c,p,state.transactions).variableSpend,100);
    const fixed=await repo.saveTransaction({...state.transactions[0],date:'2026-09-20'},1,true);
    assert.equal(fixed.transactions[0].dateNeedsConfirmation,undefined);
    process.env.TZ='America/Los_Angeles';
    const reloaded=await repo.read();assert.equal(reloaded.transactions[0].date,'2026-09-20');
    assert.equal(calculateFinance(c,p,reloaded.transactions).unresolvedCount,0);
  } finally {if(prior===undefined) delete process.env.TZ;else process.env.TZ=prior;}
});

test('date-based expense and income save into an empty ledger without creating a cycle or budget',async()=>{
  const repo=createRepository(memoryStore());
  let state=await repo.saveTransaction(tx({cycleId:null,date:'2026-10-24'}),0);
  state=await repo.saveTransaction(tx({id:'income',cycleId:null,date:'2026-09-30',type:'income',nature:null,spendKind:null,amount:0.1}),state.revision);
  assert.equal(state.transactions.length,2);
  assert.ok(state.transactions.every(item=>item.cycleId===null));
  assert.deepEqual(state.cycles,[]);assert.deepEqual(state.budgets,[]);assert.equal(state.activeCycleId,null);
  assert.deepEqual(normalizeBackup(encodeBackup(state)),state);
  await assert.rejects(repo.saveTransaction(tx({id:'no-nature',cycleId:null,nature:null}),state.revision),/确认消费性质/);
  await assert.rejects(repo.saveTransaction(tx({id:'bad-date',cycleId:null,date:'2026-02-29'}),state.revision),/日期/);
  await assert.rejects(repo.saveTransaction(tx({id:'bad-income',cycleId:null,type:'income'}),state.revision),/收入不设置/);
});

test('cycle-free records preserve all historical cycles, budgets, records and their budget calculation',async()=>{
  const repo=createRepository(memoryStore());
  let original=await repo.saveCycle(cycle,plan,0);
  original=await repo.saveTransaction(tx(),original.revision);
  const beforeMetrics=calculateFinance(original.cycles[0],original.budgets[0],original.transactions);
  const next=await repo.saveTransactions([
    tx({id:'unassigned-in-period',cycleId:null}),tx({id:'new-year',cycleId:null,date:'2027-01-01',nature:'投资'}),
  ],original.revision);
  assert.deepEqual(next.cycles,original.cycles);assert.deepEqual(next.budgets,original.budgets);
  assert.deepEqual(next.profile,original.profile);assert.equal(next.activeCycleId,original.activeCycleId);
  assert.deepEqual(next.transactions.find(item=>item.id==='a'),original.transactions[0]);
  const afterMetrics=calculateFinance(next.cycles[0],next.budgets[0],next.transactions);
  assert.equal(afterMetrics.variableSpend,beforeMetrics.variableSpend);
  assert.equal(afterMetrics.safeToSpend,beforeMetrics.safeToSpend);
  assert.deepEqual(normalizeBackup(encodeBackup(next)),next);
});

test('batch saves once with one revision and rejects stale retries or duplicate IDs without rebooking',async()=>{
  const store=memoryStore(),repo=createRepository(store);let commits=0;
  const commit=store.commit;store.commit=async(...args)=>{commits++;await commit(...args);};
  const drafts=[tx({id:'first',cycleId:null,date:'2025-12-31'}),tx({id:'second',cycleId:null,date:'2026-01-01'})];
  const saved=await repo.saveTransactions(drafts,0);
  assert.equal(saved.revision,1);assert.equal(commits,1);assert.equal(saved.transactions.length,2);
  await assert.rejects(repo.saveTransactions(drafts,0),/其他页面/);
  await assert.rejects(repo.saveTransactions(drafts,1),/重复/);
  await assert.rejects(repo.saveTransactions([tx({id:'third',cycleId:null}),tx({id:'third',cycleId:null})],1),/重复/);
  assert.equal(commits,1);assert.deepEqual(await repo.read(),saved);
});

test('batch validation is all-or-nothing and keeps explicit cycle references and legacy reserve checks',async()=>{
  const repo=createRepository(memoryStore()),state=await repo.saveCycle(cycle,plan,0);
  const valid=tx({id:'valid',cycleId:null});
  for(const invalid of [
    tx({id:'invalid',cycleId:null,nature:null}),tx({id:'invalid',cycleId:'missing'}),
    tx({id:'invalid',date:'2026-09-21'}),tx({id:'invalid',spendKind:'reserved',amount:3000.01}),
    tx({id:'invalid',cycleId:null,amount:0.001}),
  ]) {
    await assert.rejects(repo.saveTransactions([valid,invalid],state.revision));
    assert.deepEqual(await repo.read(),state);
  }
  await assert.rejects(repo.saveTransactions([],state.revision));
});

test('simultaneous batch confirmations cannot duplicate or partially mix records',async()=>{
  const store=memoryStore(),a=createRepository(store),b=createRepository(store);
  const records=[tx({id:'one',cycleId:null}),tx({id:'two',cycleId:null})];
  const results=await Promise.allSettled([a.saveTransactions(records,0),b.saveTransactions(records,0)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  const saved=await a.read();assert.equal(saved.revision,1);assert.equal(saved.transactions.length,2);
});

test('failed batch persistence does not save any draft or change revision',async()=>{
  const store=memoryStore(),repo=createRepository(store),original=await repo.read();
  store.commit=async()=>{throw Error('quota');};
  await assert.rejects(repo.saveTransactions([tx({id:'one',cycleId:null}),tx({id:'two',cycleId:null})],0),/quota/);
  assert.deepEqual(await repo.read(),original);
});

test('batch undo deletes exactly the confirmed set and leaves existing records untouched',async()=>{
  const repo=createRepository(memoryStore());
  const original=await repo.saveTransaction(tx({id:'existing',cycleId:null}),0);
  const saved=await repo.saveTransactions([tx({id:'one',cycleId:null}),tx({id:'two',cycleId:null})],original.revision);
  const undone=await repo.deleteTransactions(['one','two'],saved.revision);
  assert.equal(undone.revision,saved.revision+1);assert.deepEqual(undone.transactions,original.transactions);
  await assert.rejects(repo.deleteTransactions(['one','two'],undone.revision),/不存在/);
  assert.deepEqual(await repo.read(),undone);
});

test('undo refuses stale revisions and missing or repeated IDs, preserving later edits',async()=>{
  const repo=createRepository(memoryStore());
  const saved=await repo.saveTransactions([tx({id:'one',cycleId:null}),tx({id:'two',cycleId:null})],0);
  for(const ids of [[],['one','missing'],['one','one']]) {
    await assert.rejects(repo.deleteTransactions(ids,saved.revision));assert.deepEqual(await repo.read(),saved);
  }
  const edited=await repo.saveTransaction({...saved.transactions.find(item=>item.id==='one'),amount:123},saved.revision,true);
  await assert.rejects(repo.deleteTransactions(['one','two'],saved.revision),/其他页面/);
  assert.deepEqual(await repo.read(),edited);
});

test('v1/v2/v3 migration preserves all history under its original purpose and creates two empty independent books',()=>{
  for(const version of [1,2,3]) {
    const original={...defaultState(),version,ledgerKind:'family',revision:7,profile:{salaryDay:20},activeCycleId:cycle.id,cycles:[cycle],budgets:[plan],transactions:[tx({id:'old',note:'原始记录',date:'2026-09-15T08:00:00Z'})],
      investmentAccounts:[{id:'fund',name:'原基金',openingNetContribution:100,currentMarketValue:120,marketValueUpdatedAt:'2026-09-15',createdAt:'2026-09-15'}],
      investmentFlows:[{id:'flow',accountId:'fund',type:'contribution',amount:20,date:'2026-09-15',cycleId:cycle.id}],
      marketValueSnapshots:[{id:'snapshot',accountId:'fund',marketValue:120,date:'2026-09-15'}]};
    delete original.otherLedgers;
    const state=normalizeBackup(original);
    assert.equal(state.version,4);assert.equal(state.ledgerKind,'family');assert.equal(state.revision,version===1?0:7);
    assert.deepEqual(state.transactions.map(({id,amount,date,note})=>({id,amount,date,note})),original.transactions.map(({id,amount,date,note})=>({id,amount,date,note})));
    assert.deepEqual(state.settings,original.settings);
    assert.deepEqual(state.otherLedgers,{personal:defaultLedgerData(),travel:defaultLedgerData()});
    assert.equal(state.transactions[0].nature,version===1?null:'消费');
    if(version>1) {assert.deepEqual(state.cycles,[cycle]);assert.equal(state.profile.salaryDay,20);assert.equal(state.budgets[0].availableIncome,10000);}
    if(version===3) {assert.deepEqual(state.investmentAccounts,original.investmentAccounts);assert.deepEqual(state.investmentFlows,original.investmentFlows);assert.deepEqual(state.marketValueSnapshots,original.marketValueSnapshots);}
  }
});

test('switching ledgers round-trips separate cycles, budgets, settings and records without copying data',async()=>{
  const repo=createRepository(memoryStore());let state=await repo.saveCycle(cycle,{...plan,plannedSavings:null},0);
  state=await repo.saveTransaction(tx(),state.revision);
  state=await repo.replace({...state,settings:{monthlyBudget:1234,savingsCurrent:56,savingsGoal:789}},state.revision);
  const personal=ledgerDataOf(state);
  state=await repo.switchLedger('family',state.revision);
  assert.deepEqual(ledgerDataOf(state),defaultLedgerData());assert.deepEqual(state.otherLedgers.personal,personal);
  assert.deepEqual(Object.keys(state.otherLedgers).sort(),['personal','travel']);
  state=await repo.saveCycle(cycle,{...plan,availableIncome:5000},state.revision);
  state=await repo.saveTransaction(tx({amount:200,note:'家庭账'}),state.revision);
  const family=ledgerDataOf(state);
  state=await repo.switchLedger('travel',state.revision);
  assert.deepEqual(ledgerDataOf(state),defaultLedgerData());
  state=await repo.saveTransaction(tx({cycleId:null,amount:300,note:'旅行账'}),state.revision);
  const travel=ledgerDataOf(state);
  for(const [kind,expected] of [['personal',personal],['family',family],['travel',travel]]) {
    const revision=state.revision;state=await repo.switchLedger(kind,revision);
    assert.equal(state.revision,revision+1);assert.deepEqual(ledgerDataOf(state),expected);
    assert.equal(state.otherLedgers[kind],undefined);
  }
});

test('manual edits, deletions and AI batch save/undo affect only the active ledger even when IDs repeat',async()=>{
  const repo=createRepository(memoryStore());let state=await repo.saveTransaction(tx({cycleId:null,note:'个人原账'}),0);
  const personal=ledgerDataOf(state);
  state=await repo.switchLedger('family',state.revision);
  state=await repo.saveTransactions([tx({cycleId:null,amount:20}),tx({id:'batch-two',cycleId:null,amount:30})],state.revision);
  state=await repo.saveTransaction(tx({cycleId:null,amount:25,note:'家庭改账'}),state.revision,true);
  state=await repo.deleteTransaction('batch-two',state.revision);
  assert.deepEqual(state.otherLedgers.personal,personal);
  const batch=await repo.saveTransactions([tx({id:'one',cycleId:null}),tx({id:'two',cycleId:null})],state.revision);
  state=await repo.deleteTransactions(['one','two'],batch.revision);
  assert.equal(state.transactions[0].amount,25);assert.deepEqual(state.otherLedgers.personal,personal);
  state=await repo.deleteTransaction('a',state.revision);assert.deepEqual(state.transactions,[]);
  state=await repo.switchLedger('personal',state.revision);assert.deepEqual(ledgerDataOf(state),personal);
});

test('investment accounts, flows and valuations stay inside their ledger and allow repeated local IDs',async()=>{
  const account={id:'fund',name:'基金',openingNetContribution:100,currentMarketValue:120,marketValueUpdatedAt:'2026-10-24',createdAt:'2026-10-24'};
  const flow={id:'flow',accountId:'fund',type:'contribution',amount:20,date:'2026-10-24',cycleId:null};
  const repo=createRepository(memoryStore());let state=await repo.saveInvestmentAccount(account,0);
  state=await repo.saveInvestmentFlow(flow,state.revision);const personal=ledgerDataOf(state);
  state=await repo.switchLedger('family',state.revision);
  await assert.rejects(repo.saveInvestmentFlow(flow,state.revision),/账户不存在/);
  await assert.rejects(repo.saveMarketValue('fund',500,'2026-10-24',state.revision),/账户不存在/);
  state=await repo.saveInvestmentAccount({...account,name:'家庭基金',currentMarketValue:500},state.revision);
  state=await repo.saveInvestmentFlow({...flow,amount:400},state.revision);
  state=await repo.saveMarketValue('fund',550,'2026-10-25',state.revision);
  assert.equal(state.investmentAccounts[0].currentMarketValue,550);assert.equal(state.investmentFlows[0].amount,400);
  assert.deepEqual(state.otherLedgers.personal,personal);
  state=await repo.switchLedger('personal',state.revision);assert.deepEqual(ledgerDataOf(state),personal);
});

test('complete v4 backup restores every book and rejects corrupt inactive books without partial replacement',async()=>{
  const source=createRepository(memoryStore());let state=await source.ensureCurrentCycle('2026-10-24');
  state=await source.saveTransaction(tx({cycleId:state.activeCycleId,date:'2026-10-24'}),state.revision);
  state=await source.switchLedger('travel',state.revision);
  state=await source.saveTransaction(tx({cycleId:null,amount:250}),state.revision);
  const backup=JSON.parse(JSON.stringify({...encodeBackup(state),exportedAt:'2026-10-24T00:00:00Z'}));
  const restored=normalizeBackup(backup);assert.deepEqual(restored,state);
  const repo=createRepository(memoryStore());const saved=await repo.replace(restored,0);assert.deepEqual(saved,{...state,revision:1});
  const invalid=[];
  const change=fn=>{const item=structuredClone(backup);fn(item);invalid.push(item);};
  change(item=>{item.otherLedgers.travel=defaultLedgerData();});
  change(item=>{delete item.otherLedgers.personal;});
  change(item=>{item.otherLedgers.personal.otherLedgers={};});
  change(item=>{item.otherLedgers.personal.revision=1;});
  change(item=>{item.otherLedgers.personal.transactions[0].date='2027-01-01';});
  change(item=>{item.otherLedgers.personal.transactions.push({...item.otherLedgers.personal.transactions[0]});});
  change(item=>{item.otherLedgers.family.investmentFlows=[{id:'bad',accountId:'absent',type:'contribution',amount:10,date:'2026-10-24',cycleId:null}];});
  for(const item of invalid) {
    assert.throws(()=>normalizeBackup(item));await assert.rejects(repo.replace(item,saved.revision));assert.deepEqual(await repo.read(),saved);
  }
});

test('global revision rejects stale edits, AI saves and undo after switching; concurrent switches commit once',async()=>{
  const store=memoryStore(),a=createRepository(store),b=createRepository(store);
  const personal=await a.saveTransactions([tx({cycleId:null}),tx({id:'b',cycleId:null})],0);
  const family=await b.switchLedger('family',personal.revision);
  for(const action of [()=>a.saveTransaction(tx({cycleId:null,amount:999}),personal.revision,true),()=>a.saveTransactions([tx({id:'new',cycleId:null})],personal.revision),()=>a.deleteTransactions(['a','b'],personal.revision),()=>a.switchLedger('travel',personal.revision)]) await assert.rejects(action(),/其他页面/);
  assert.deepEqual(await a.read(),family);
  const results=await Promise.allSettled([a.switchLedger('personal',family.revision),b.switchLedger('travel',family.revision)]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
  const current=await a.read();assert.equal(current.revision,family.revision+1);
  const previous=structuredClone(current);store.commit=async()=>{throw Error('quota');};
  await assert.rejects(a.switchLedger(current.ledgerKind==='family'?'travel':'family',current.revision),/quota/);
  assert.deepEqual(await a.read(),previous);
});

async function seedOldDatabase(state) {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-ledger-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('ledger');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const t=db.transaction('ledger','readwrite');t.objectStore('ledger').put(state,'current');t.oncomplete=resolve;t.onabort=()=>reject(t.error);});
  return db;
}

test('v4 fallback stays authoritative and the IDB version guard prevents old clients from reopening stale IDB',async()=>{
  const map=browser();const old={...defaultState(),version:3,revision:2,transactions:[tx({cycleId:null,note:'旧IDB'})]};delete old.otherLedgers;
  (await seedOldDatabase(old)).close();
  const fallback={...defaultState(),revision:9,transactions:[tx({cycleId:null,note:'新版备用'})],otherLedgers:{family:{...defaultLedgerData(),transactions:[tx({cycleId:null,amount:200})]},travel:defaultLedgerData()}};
  map.set('xiaoman-ledger-local-v1',JSON.stringify(fallback));
  const repo=createRepository(createLocalStore());assert.deepEqual(await repo.read(),fallback);
  await assert.rejects(new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-ledger-db',1);r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);}),error=>error.name==='VersionError');
  const switched=await repo.switchLedger('family',9);assert.equal(switched.transactions[0].amount,200);
  assert.deepEqual(await createRepository(createLocalStore()).read(),switched);
  assert.equal(JSON.parse(map.get('xiaoman-ledger-local-v1')).version,4);
});

test('blocked IDB upgrade preserves both stores and closes a late successful connection',async()=>{
  const map=browser();const old={...defaultState(),version:3,revision:2,transactions:[tx({cycleId:null})]};delete old.otherLedgers;
  const held=await seedOldDatabase(old);
  const raw=JSON.stringify({...defaultState(),revision:9});map.set('xiaoman-ledger-local-v1',raw);
  await assert.rejects(createRepository(createLocalStore()).read(),/旧页面占用/);
  assert.equal(map.get('xiaoman-ledger-local-v1'),raw);held.close();
  // A later version upgrade would block if the rejected open(2) leaked its late connection.
  const probe=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-ledger-db',3);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('late connection leaked'));});
  const preserved=await new Promise((resolve,reject)=>{const t=probe.transaction('ledger','readonly'),r=t.objectStore('ledger').get('current');t.oncomplete=()=>resolve(r.result);t.onabort=()=>reject(t.error);});probe.close();
  assert.deepEqual(preserved,old);assert.equal(map.get('xiaoman-ledger-local-v1'),raw);
});

test('a v3 fallback cannot silently hide an already persisted v4 multi-ledger database',async()=>{
  const map=browser(),repo=createRepository(createLocalStore());let state=await repo.saveTransaction(tx({cycleId:null}),0);
  state=await repo.switchLedger('family',state.revision);state=await repo.saveTransaction(tx({cycleId:null,amount:200}),state.revision);
  const old={...defaultState(),version:3,revision:99};delete old.otherLedgers;
  const raw=JSON.stringify(old);map.set('xiaoman-ledger-local-v1',raw);
  await assert.rejects(createRepository(createLocalStore()).read(),/新版账本与旧备用账本同时存在/);
  assert.equal(map.get('xiaoman-ledger-local-v1'),raw);
  map.delete('xiaoman-ledger-local-v1');assert.deepEqual(await createRepository(createLocalStore()).read(),state);
});
