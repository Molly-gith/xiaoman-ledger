import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { defaultState, encodeBackup, normalizeBackup } from '../lib/data/schema.ts';
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
test('optional budgets encode as legacy-readable numeric fields and restore unknown independently from real zero',async()=>{
  const repo=createRepository(memoryStore());let state=await repo.ensureCurrentCycle('2026-10-10');
  state=await repo.saveTransaction(tx({cycleId:state.activeCycleId,date:'2026-10-10'}),state.revision);
  const backup=JSON.parse(JSON.stringify(encodeBackup(state)));
  assert.equal(backup.version,3);
  assert.equal(backup.budgets[0].availableIncome,0);
  assert.equal(backup.budgets[0].plannedSavings,0);
  assert.equal(backup.budgets[0].availableIncomeKnown,false);
  assert.equal(backup.budgets[0].plannedSavingsKnown,false);
  assert.deepEqual(normalizeBackup(backup),state);
  const legacyView=structuredClone(backup);
  for(const budget of legacyView.budgets) {
    delete budget.availableIncomeKnown;delete budget.plannedSavingsKnown;
  }
  assert.deepEqual(normalizeBackup(legacyView).transactions,state.transactions);
  state=await repo.saveCycle(state.cycles[0],{...state.budgets[0],availableIncome:0,plannedSavings:2500},state.revision);
  const known=encodeBackup(state);
  assert.equal(known.budgets[0].availableIncomeKnown,undefined);
  assert.equal(known.budgets[0].plannedSavings,2500);
  assert.deepEqual(normalizeBackup(known),state);
  const invalid=structuredClone(known);invalid.budgets[0].plannedSavingsKnown=false;
  assert.throws(()=>normalizeBackup(invalid),/兼容字段/);
});
test('IndexedDB and fallback store only backward-compatible budget numbers while read returns null',async()=>{
  const map=browser();const repo=createRepository(createLocalStore());
  const first=await repo.ensureCurrentCycle('2026-10-10');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-ledger-db',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const raw=await new Promise((resolve,reject)=>{const t=db.transaction('ledger','readonly'),r=t.objectStore('ledger').get('current');t.oncomplete=()=>resolve(r.result);t.onabort=()=>reject(t.error);});db.close();
  assert.equal(raw.budgets[0].availableIncome,0);
  assert.equal(raw.budgets[0].availableIncomeKnown,false);
  assert.deepEqual(await createRepository(createLocalStore()).read(),first);
  map.set('xiaoman-ledger-local-v1',JSON.stringify({...raw,revision:10}));
  const fallback=createRepository(createLocalStore());
  const next=await fallback.ensureCurrentCycle('2026-11-01');
  const stored=JSON.parse(map.get('xiaoman-ledger-local-v1'));
  assert.equal(stored.budgets[1].availableIncome,0);
  assert.equal(stored.budgets[1].plannedSavingsKnown,false);
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
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xiaoman-ledger-db',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
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
