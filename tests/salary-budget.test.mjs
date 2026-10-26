import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateSalaryBudget, calculateSalaryBudget, normalizeSalaryBudgetSettings, salaryBudgetRange, salaryPaydayRange } from '../lib/domain/salary-budget.ts';
import { createRepository } from '../lib/data/repository.ts';
import { createCloudRepository } from '../lib/data/cloud-adapter.ts';
import { defaultState, encodeBackup, normalizeBackup } from '../lib/data/schema.ts';

const range=(startDate,endDate)=>({startDate,endDate});
const settings=(patch={})=>({enabled:true,periodMode:'calendar_month',salaryDay:null,expectedSalary:10000,
  percentages:{消费:70,浪费:5,投资:25},periodOverride:null,...patch});
const tx=(id,amount,nature='消费',patch={})=>({id,amount,nature,type:'expense',date:'2026-10-26',cycleId:null,
  category:'其他',note:'虚拟记录',icon:'其',source:'text',spendKind:'variable',...patch});
const summary=(records=[],config=settings(),today='2026-10-26')=>calculateSalaryBudget(config,records,today);
const row=(result,nature='消费')=>result.rows.find(item=>item.nature===nature);
function memoryStore(initial=defaultState()){
  let state=structuredClone(initial);
  return {read:async()=>structuredClone(state),commit:async(next,revision)=>{
    if(state.revision!==revision)throw Error('conflict');
    state=structuredClone(next);
  }};
}

test('salary budgeting is opt-in and disabled settings retain their values without an income or cycle',async()=>{
  assert.equal(defaultState().salaryBudget,null);
  assert.equal(normalizeSalaryBudgetSettings(undefined),null);
  assert.equal(summary([],null),null);
  assert.equal(summary([],{...settings(),enabled:false}),null);
  const repo=createRepository(memoryStore());
  const saved=await repo.saveSalaryBudget(settings(),0);
  assert.deepEqual(saved.transactions,[]);assert.deepEqual(saved.cycles,[]);assert.deepEqual(saved.budgets,[]);
  assert.equal(saved.activeCycleId,null);assert.equal(saved.profile,null);
  const disabled=await repo.saveSalaryBudget({...saved.salaryBudget,enabled:false},saved.revision);
  assert.deepEqual(disabled.salaryBudget,{...settings(),enabled:false});
  assert.deepEqual(disabled.transactions,[]);
});

test('settings reject malformed or conflicting money, percentage, payday and override values atomically',async()=>{
  const invalid=[
    {...settings(),other:1},{...settings(),enabled:'true'},{...settings(),expectedSalary:'10000'},
    {...settings(),expectedSalary:-1},{...settings(),expectedSalary:0.001},{...settings(),expectedSalary:Infinity},
    {...settings(),percentages:{消费:70,浪费:10,投资:25}},
    {...settings(),percentages:{消费:70,浪费:-1,投资:25}},
    {...settings(),percentages:{消费:70.001,浪费:5,投资:24.999}},
    {...settings(),percentages:{消费:70,浪费:5,投资:25,其他:0}},
    {...settings(),percentages:{消费:70,浪费:5}},
    {...settings(),salaryDay:0},{...settings(),salaryDay:32},{...settings(),salaryDay:1.5},
    {...settings(),periodMode:'salary_based',salaryDay:null},
    {...settings(),periodOverride:{startDate:'2026-10-02',endDate:'2026-10-31',salary:9000}},
    {...settings(),periodOverride:{startDate:'2026-10-01',endDate:'2026-11-01',salary:9000}},
    {...settings(),periodOverride:{startDate:'2026-10-01',endDate:'2026-10-31',salary:-1}},
  ];
  const repo=createRepository(memoryStore()),before=await repo.read();
  for(const value of invalid){
    assert.throws(()=>normalizeSalaryBudgetSettings(value));
    await assert.rejects(repo.saveSalaryBudget(value,0));
    assert.deepEqual(await repo.read(),before);
  }
  assert.equal(normalizeSalaryBudgetSettings(settings({expectedSalary:0,percentages:{消费:0,浪费:0,投资:0}})).expectedSalary,0);
});

test('cent allocation has a stable total, leaves unused percentage unallocated and never rounds a zero share up',()=>{
  assert.deepEqual(allocateSalaryBudget(10000,{消费:60,浪费:0,投资:25}),
    {baseFen:1000000,amountsFen:{消费:600000,浪费:0,投资:250000},unallocatedFen:150000});
  assert.deepEqual(allocateSalaryBudget(0.03,{消费:50,浪费:0,投资:50}),
    {baseFen:3,amountsFen:{消费:2,浪费:0,投资:1},unallocatedFen:0});
  assert.deepEqual(allocateSalaryBudget(0.01,{消费:33.33,浪费:33.33,投资:33.34}),
    {baseFen:1,amountsFen:{消费:0,浪费:0,投资:1},unallocatedFen:0});
  const partial=allocateSalaryBudget(1.01,{消费:33.33,浪费:0,投资:33.33});
  assert.equal(partial.amountsFen.消费+partial.amountsFen.投资,67);assert.equal(partial.unallocatedFen,34);
  for(const salary of [0,0.01,0.07,4321.09,999999999999.99]){
    for(const ratios of [{消费:70,浪费:5,投资:25},{消费:0,浪费:0,投资:0},{消费:33.33,浪费:33.33,投资:33.34}]){
      const value=allocateSalaryBudget(salary,ratios);
      assert.equal(Object.values(value.amountsFen).reduce((a,b)=>a+b,0)+value.unallocatedFen,value.baseFen);
      assert.ok(Object.values(value.amountsFen).every(Number.isSafeInteger));
    }
  }
});

test('salary windows clip payday in short months and stay contiguous across leap years and year boundaries',()=>{
  assert.deepEqual(salaryBudgetRange(settings(),'2024-02-29'),range('2024-02-01','2024-02-29'));
  assert.deepEqual(salaryPaydayRange('2026-02-27',31),range('2026-01-31','2026-02-27'));
  assert.deepEqual(salaryPaydayRange('2026-02-28',31),range('2026-02-28','2026-03-30'));
  assert.deepEqual(salaryPaydayRange('2024-02-29',31),range('2024-02-29','2024-03-30'));
  assert.deepEqual(salaryPaydayRange('2026-01-01',20),range('2025-12-20','2026-01-19'));
  assert.deepEqual(salaryPaydayRange('2026-10-20',20),range('2026-10-20','2026-11-19'));
  assert.deepEqual(salaryBudgetRange(settings({enabled:false,periodMode:'salary_based',salaryDay:20}),'2026-10-20'),range('2026-10-20','2026-11-19'));
  assert.throws(()=>salaryPaydayRange('1900-01-01',31));
  assert.throws(()=>salaryBudgetRange(settings(),'2026-02-29'));
});

test('budget spend uses transaction dates including cycle-free records and never actual salary income',()=>{
  const records=[
    tx('first',0.1,'消费',{date:'2026-10-01'}),tx('second',0.2,'消费',{cycleId:'legacy-unrelated-id'}),
    tx('waste',12,'浪费'),tx('investment',200,'投资'),
    tx('before',1000,'消费',{date:'2026-09-30'}),tx('after',1000,'消费',{date:'2026-11-01'}),
    tx('salary',9000,null,{type:'income',category:'收入',spendKind:null}),
  ];
  const before=structuredClone(records),result=summary(records);
  assert.equal(row(result).spentFen,30);assert.equal(row(result,'浪费').spentFen,1200);
  assert.equal(row(result,'投资').spentFen,20000);assert.equal(result.baseFen,1000000);
  assert.deepEqual(records,before);assert.equal(row(result).remainingFen,699970);
  const pay=summary(records,settings({periodMode:'salary_based',salaryDay:20}),'2026-10-26');
  assert.equal(row(pay).spentFen,100020,'Oct 26 plus Nov 1 belong to the current salary window, Oct 1 does not');
});

test('only investment-nature expenses count toward its target, independent of category, accounts and market values',()=>{
  const state={...defaultState(),salaryBudget:settings(),transactions:[
    tx('course',400,'投资',{category:'学习'}),tx('regular',80,'消费',{category:'学习'})],
    investmentAccounts:[{id:'fund',name:'虚拟账户',openingNetContribution:5000,currentMarketValue:9000,marketValueUpdatedAt:'2026-10-26',createdAt:'2026-10-26'}],
    investmentFlows:[{id:'flow',accountId:'fund',type:'contribution',amount:3000,date:'2026-10-26',cycleId:null}],
  };
  const result=summary(state.transactions,state.salaryBudget);
  assert.equal(row(result,'投资').spentFen,40000);assert.equal(row(result).spentFen,8000);
  assert.equal(row(result,'投资').status,'target');
  assert.equal(row(summary([tx('large',5000,'投资')]),'投资').status,'target','investment never emits an expense-cap alert');
});

test('consumption and waste have exact eighty-percent and over-one-hundred thresholds; zero waste is meaningful',()=>{
  const config=settings({expectedSalary:100,percentages:{消费:50,浪费:0,投资:25}});
  assert.equal(row(summary([tx('under',39.99)],config)).status,'ok');
  assert.equal(row(summary([tx('near',40)],config)).status,'near');
  assert.equal(row(summary([tx('at',50)],config)).status,'near');
  const over=row(summary([tx('over',50.01)],config));
  assert.equal(over.status,'over');assert.equal(over.remainingFen,-1);
  assert.equal(row(summary([],config),'浪费').status,'ok');
  assert.equal(row(summary([tx('waste',0.01,'浪费')],config),'浪费').status,'over');
  assert.equal(row(summary([tx('waste',0.01,'浪费')],config),'浪费').usedPercent,null);
});

test('editing or deleting spend recalculates thresholds without keeping stale alert history',()=>{
  const config=settings({expectedSalary:100,percentages:{消费:100,浪费:0,投资:0}});
  const first=summary([tx('one',79.99)],config);
  const near=summary([tx('one',79.99),tx('two',0.01)],config);
  const over=summary([tx('one',101)],config),edited=summary([tx('one',75)],config);
  assert.deepEqual([row(first).status,row(near).status,row(over).status,row(edited).status,row(summary([],config)).status],['ok','near','over','ok','ok']);
});

test('unconfirmed dates are separate, including possible boundary dates, and do not produce definite alerts',()=>{
  const records=[
    tx('certain',8000),tx('pending',9000,'消费',{date:'2026-10-12T12:00:00Z'}),
    tx('near-boundary',50,'浪费',{date:'2026-09-30T16:30:00Z'}),
    tx('far-away',500,'消费',{date:'2025-01-01T00:00:00Z'}),
    tx('marked',5,'投资',{dateNeedsConfirmation:true}),
  ];
  const result=summary(records);
  assert.equal(result.pendingDateCount,3);assert.equal(result.pendingDateAmountFen,905500);
  assert.equal(row(result).spentFen,800000);assert.equal(row(result,'浪费').spentFen,0);
  assert.equal(result.alertsSuppressed,true);assert.equal(row(result).status,'pending');
  assert.equal(row(result,'投资').spentFen,0);
  const confirmed=summary([tx('certain',8000),tx('pending',9000),tx('near-boundary',50,'浪费',{date:'2026-10-01'}),tx('marked',5,'投资')]);
  assert.equal(confirmed.alertsSuppressed,false);assert.equal(row(confirmed).status,'over');
});

test('unclassified historical expenses are visible separately instead of silently becoming consumption',()=>{
  const result=summary([tx('known',20),tx('unknown',100,null)]);
  assert.equal(row(result).spentFen,2000);assert.equal(result.unclassifiedCount,1);
  assert.equal(result.unclassifiedAmountFen,10000);assert.equal(result.alertsSuppressed,true);
  assert.equal(row(result).status,'pending');
});

test('temporary salary overrides exactly one date window and recomputes amounts without changing future salary',()=>{
  const config=settings({periodOverride:{startDate:'2026-10-01',endDate:'2026-10-31',salary:8000}});
  const before=structuredClone(config),oct=summary([],config),nov=summary([],config,'2026-11-01');
  assert.equal(oct.overrideApplied,true);assert.equal(oct.baseFen,800000);assert.equal(row(oct).budgetFen,560000);
  assert.equal(nov.overrideApplied,false);assert.equal(nov.baseFen,1000000);assert.equal(row(nov).budgetFen,700000);
  assert.equal(summary([],config,'2026-09-30').overrideApplied,false);assert.deepEqual(config,before);
  const zero=summary([],settings({periodOverride:{startDate:'2026-10-01',endDate:'2026-10-31',salary:0}}));
  assert.equal(zero.overrideApplied,true);assert.equal(zero.baseFen,0);
  const clipped=settings({periodMode:'salary_based',salaryDay:31,periodOverride:{startDate:'2026-02-28',endDate:'2026-03-30',salary:1234.56}});
  assert.equal(summary([],clipped,'2026-02-28').baseFen,123456);
  assert.equal(summary([],clipped,'2026-03-31').baseFen,1000000);
});

test('money and aggregate overflows fail instead of returning fabricated exact amounts',()=>{
  assert.throws(()=>summary([tx('fraction',0.001)]));
  assert.throws(()=>summary([tx('same',1),tx('same',2)]),/重复/);
  const many=Array.from({length:91},(_,i)=>tx(String(i),999999999999.99));
  assert.throws(()=>summary(many),/合计/);
  const valid=summary(many.slice(0,90));
  assert.equal(row(valid).spentFen,8999999999999910);
  assert.equal(row(valid).status,'over');
});

test('old v4 and earlier backups remain readable with all salary budgets disabled',()=>{
  const old=defaultState();old.transactions=[tx('historic',25)];
  delete old.salaryBudget;
  for(const book of Object.values(old.otherLedgers))delete book.salaryBudget;
  const next=normalizeBackup(old);
  assert.equal(next.salaryBudget,null);assert.equal(next.otherLedgers.family.salaryBudget,null);assert.equal(next.otherLedgers.travel.salaryBudget,null);
  assert.deepEqual(next.transactions,old.transactions);
  for(const version of [1,2,3]){
    const previous={...old,version};delete previous.otherLedgers;
    const restored=normalizeBackup(previous);
    assert.equal(restored.salaryBudget,null);assert.equal(restored.transactions[0].amount,25);
  }
  const corrupt=structuredClone(old);corrupt.otherLedgers.family.unexpected=true;
  assert.throws(()=>normalizeBackup(corrupt),/独立数据/);
});

test('budget settings, original transactions and full backup survive switches, ordinary edits and restore',async()=>{
  const repo=createRepository(memoryStore());
  let state=await repo.saveTransaction(tx('original',35),0);
  const original=structuredClone(state.transactions);
  state=await repo.saveSalaryBudget(settings(),state.revision);
  assert.deepEqual(state.transactions,original);
  state=await repo.switchLedger('family',state.revision);assert.equal(state.salaryBudget,null);
  const family=settings({expectedSalary:20000,percentages:{消费:80,浪费:0,投资:10},periodMode:'salary_based',salaryDay:15});
  state=await repo.saveSalaryBudget(family,state.revision);
  state=await repo.saveTransaction(tx('family-entry',50),state.revision);
  assert.deepEqual(state.salaryBudget,family);assert.deepEqual(state.otherLedgers.personal.salaryBudget,settings());
  state=await repo.switchLedger('travel',state.revision);assert.equal(state.salaryBudget,null);
  const backup=JSON.parse(JSON.stringify(encodeBackup(state)));
  assert.deepEqual(normalizeBackup(backup),state);
  const restored=createRepository(memoryStore());state=await restored.replace(normalizeBackup(backup),0);
  state=await restored.switchLedger('personal',state.revision);
  assert.deepEqual(state.transactions,original);assert.deepEqual(state.salaryBudget,settings());
  state=await restored.saveSalaryBudget({...state.salaryBudget,enabled:false},state.revision);
  assert.deepEqual(state.transactions,original);assert.deepEqual(state.otherLedgers.family.salaryBudget,family);
  state=await restored.saveSalaryBudget(null,state.revision);assert.deepEqual(state.transactions,original);
});

test('malformed inactive budget blocks full restore atomically and stale budget saves cannot cross books',async()=>{
  const store=memoryStore(),repo=createRepository(store);
  const configured=await repo.saveSalaryBudget(settings(),0);
  const switched=await repo.switchLedger('family',configured.revision);
  await assert.rejects(repo.saveSalaryBudget(settings({expectedSalary:1}),configured.revision),/其他页面/);
  const broken=structuredClone(switched);
  broken.otherLedgers.personal.salaryBudget.percentages.消费=100;
  await assert.rejects(repo.replace(broken,switched.revision),/比例/);
  assert.deepEqual(await repo.read(),switched);
  const originalCommit=store.commit;store.commit=async()=>{throw Error('quota');};
  await assert.rejects(repo.saveSalaryBudget(settings(),switched.revision),/quota/);
  assert.deepEqual(await repo.read(),switched);store.commit=originalCommit;
});

test('cloud JSON round-trips the independent settings without creating salaries or leaking into another owner',async()=>{
  const records=new Map(),calls=[];
  const client=owner=>({async rpc(name,args){
    calls.push(structuredClone({owner,name,args}));
    if(args.expected_user_id!==owner)return {data:null,error:{code:'42501'}};
    const current=records.get(owner);
    if(name==='xiaoman_read_resources')return {data:current?[structuredClone(current)]:[],error:null};
    const change=args.changes[0];
    if((current?.revision??0)!==change.expected_revision)return {data:null,error:{code:'40001'}};
    const saved={resource:'ledger',revision:change.expected_revision+1,payload:JSON.parse(JSON.stringify(change.payload))};
    records.set(owner,saved);return {data:[structuredClone(saved)],error:null};
  }});
  const alice='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bob='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const aClient=client(alice),a=createCloudRepository(aClient,alice,()=>true),b=createCloudRepository(client(bob),bob,()=>true);
  let saved=await a.saveSalaryBudget(settings(),0);
  saved=await a.switchLedger('family',saved.revision);
  saved=await a.saveSalaryBudget(settings({expectedSalary:12000}),saved.revision);
  const reload=createCloudRepository(aClient,alice,()=>true);
  assert.deepEqual(await reload.read(),saved);
  assert.equal((await b.read()).salaryBudget,null);
  const bState=await b.saveSalaryBudget(settings({expectedSalary:9000}),0);
  assert.equal(bState.salaryBudget.expectedSalary,9000);
  const aState=await reload.read();
  assert.equal(aState.salaryBudget.expectedSalary,12000);assert.equal(aState.otherLedgers.personal.salaryBudget.expectedSalary,10000);
  assert.deepEqual(aState.transactions,[]);assert.deepEqual(aState.otherLedgers.personal.transactions,[]);
  assert.ok(calls.filter(call=>call.name==='xiaoman_write_resources').every(call=>Object.hasOwn(call.args.changes[0].payload,'salaryBudget')));
});
