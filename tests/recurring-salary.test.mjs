import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOMATIC_SALARY_NOTE, isManualSalaryForMonth, prepareRecurringSalarySettings, reconcileRecurringSalary, recurringSalaryToday, scheduledSalaryDate } from '../lib/domain/recurring-salary.ts';
import { allocateSalaryBudgetAmounts, calculateSalaryBudget, normalizeSalaryBudgetSettings } from '../lib/domain/salary-budget.ts';
import { defaultState, encodeBackup, normalizeBackup, normalizeTransaction } from '../lib/data/schema.ts';

const settings=(patch={})=>({enabled:true,periodMode:'calendar_month',salaryDay:20,expectedSalary:7000,
  percentages:{消费:70,浪费:5,投资:25},amounts:{消费:4900,浪费:350,投资:1750},periodOverride:null,
  autoIncome:{enabled:true,startDate:'2026-10-20',lastProcessedMonth:null},...patch});
const income=(id,note='十月工资',patch={})=>({id,type:'income',amount:6500,date:'2026-10-20',category:'收入',
  note,icon:'薪',source:'text',cycleId:null,nature:null,spendKind:null,...patch});
const run=(config=settings(),records=[],today='2026-10-20')=>reconcileRecurringSalary(config,records,today);

test('old settings and stopped budget/salary remain passive with no income or rewritten records',()=>{
  const legacy=settings();delete legacy.autoIncome;delete legacy.amounts;
  for(const config of [null,legacy,settings({enabled:false}),settings({autoIncome:{enabled:false,startDate:'2026-10-20',lastProcessedMonth:null}})]){
    const records=[income('existing')],before=structuredClone(records),result=run(config,records);
    assert.equal(result.changed,false);assert.deepEqual(result.added,[]);assert.deepEqual(result.transactions,before);assert.deepEqual(records,before);
  }
  assert.deepEqual(normalizeSalaryBudgetSettings(legacy),legacy);
});

test('the device scheduling clock agrees with Hong Kong around midnight and year rollover',()=>{
  assert.equal(recurringSalaryToday(new Date('2026-10-19T15:59:59Z')),'2026-10-19');
  assert.equal(recurringSalaryToday(new Date('2026-10-19T16:00:00Z')),'2026-10-20');
  assert.equal(recurringSalaryToday(new Date('2026-12-31T16:00:00Z')),'2027-01-01');
  assert.throws(()=>recurringSalaryToday(new Date('invalid')));
});

test('first enable cannot backdate activation but can create today once if today is payday',()=>{
  const request=settings({autoIncome:{enabled:true,startDate:'2020-01-01',lastProcessedMonth:'2025-12'}});
  const config=prepareRecurringSalarySettings(null,request,'2026-10-20');
  assert.deepEqual(config.autoIncome,{enabled:true,startDate:'2026-10-20',lastProcessedMonth:null});
  const result=run(config);
  assert.equal(result.added.length,1);assert.equal(result.added[0].id,'salary-auto-2026-10');
  assert.equal(result.added[0].amount,7000);assert.equal(result.added[0].note,AUTOMATIC_SALARY_NOTE);
  assert.deepEqual(result.added[0].autoSalary,{month:'2026-10',scheduledDate:'2026-10-20'});
  assert.equal(result.settings.autoIncome.lastProcessedMonth,'2026-10');
  assert.equal(result.transactions[0].type,'income');assert.equal(result.transactions[0].cycleId,null);
  assert.equal(config.autoIncome.lastProcessedMonth,null,'pure transformation leaves caller input unchanged');
});

test('activation after payday does not backfill the earlier payday and records its skipped month watermark',()=>{
  const config=prepareRecurringSalarySettings(null,settings(),'2026-10-27');
  const first=run(config,[],'2026-10-27');
  assert.equal(first.added.length,0);assert.equal(first.settings.autoIncome.lastProcessedMonth,'2026-10');
  assert.equal(run(first.settings,first.transactions,'2026-10-28').changed,false);
  const next=run(first.settings,first.transactions,'2026-11-20');
  assert.deepEqual(next.added.map(tx=>tx.date),['2026-11-20']);
});

test('scheduled day clips in short months and catch-up remains monthly through leap years and year boundaries',()=>{
  assert.equal(scheduledSalaryDate('2026-02',31),'2026-02-28');
  assert.equal(scheduledSalaryDate('2024-02',31),'2024-02-29');
  assert.equal(scheduledSalaryDate('2026-04',31),'2026-04-30');
  assert.throws(()=>scheduledSalaryDate('2026-13',20));assert.throws(()=>scheduledSalaryDate('2026-10',32));
  const config=settings({salaryDay:31,autoIncome:{enabled:true,startDate:'2025-12-01',lastProcessedMonth:null}});
  const result=run(config,[],'2026-03-30');
  assert.deepEqual(result.added.map(tx=>tx.date),['2025-12-31','2026-01-31','2026-02-28']);
  assert.equal(result.settings.autoIncome.lastProcessedMonth,'2026-02');
  const march=run(result.settings,result.transactions,'2026-03-31');
  assert.deepEqual(march.added.map(tx=>tx.date),['2026-03-31']);
  assert.equal(run(config,[],'2025-12-30').changed,false);
});

test('watermark makes repeated processing and user deletion idempotent without recreating missing wages',()=>{
  const result=run();
  assert.equal(run(result.settings,result.transactions).changed,false);
  const afterDeletion=run(result.settings,[],'2026-10-30');
  assert.equal(afterDeletion.added.length,0);assert.equal(afterDeletion.changed,false);
  const next=run(result.settings,[],'2026-11-20');
  assert.deepEqual(next.added.map(tx=>tx.autoSalary.month),['2026-11']);
});

test('existing deterministic ID or provenance suppresses a duplicate even after editing actual date and amount',()=>{
  const original=run().added[0];
  for(const edited of [
    {...original,date:'2026-11-01',amount:7100,note:'实际到账已核对'},
    {...original,id:'imported-id',date:'2026-10-22',amount:6999},
    (()=>{const value={...original};delete value.autoSalary;return value;})(),
  ]){
    const result=run(settings(),[edited]);
    assert.equal(result.added.length,0);assert.deepEqual(result.transactions,[edited]);
    assert.equal(result.settings.autoIncome.lastProcessedMonth,'2026-10');
  }
  const moved={...original,date:'2026-11-01'};
  assert.equal(isManualSalaryForMonth(moved,'2026-11'),false);
});

test('explicit manual wages suppress another salary regardless of amount; mere transfers and equal amounts do not',()=>{
  for(const note of ['10月工资到账','本月薪资','薪水','月薪酬','October salary','PAYROLL','工资少了200']){
    const manual=income('manual',note,{amount:6980});
    assert.equal(isManualSalaryForMonth(manual,'2026-10'),true,note);
    const result=run(settings(),[manual]);
    assert.deepEqual(result.skippedManualMonths,['2026-10']);assert.equal(result.added.length,0);
    assert.equal(result.settings.autoIncome.lastProcessedMonth,'2026-10');assert.deepEqual(result.transactions,[manual]);
  }
  for(const note of ['报销','从另一张卡转入','工资卡转入','薪资账户转入','这不是工资，是报销','非薪资','salarycard transfer']){
    const other=income('other',note,{amount:7000});
    assert.equal(isManualSalaryForMonth(other,'2026-10'),false,note);
    assert.equal(run(settings(),[other]).added.length,1,note);
  }
  assert.equal(run(settings(),[income('last-month','九月工资',{date:'2026-09-20'})]).added.length,1);
});

test('legacy timestamp wage candidates near a month boundary avoid a timezone-dependent second wage',()=>{
  const uncertain=income('old','工资',{date:'2026-09-30T16:30:00Z'});
  assert.equal(isManualSalaryForMonth(uncertain,'2026-10'),true);
  assert.equal(run(settings(),[uncertain]).added.length,0);
  assert.equal(isManualSalaryForMonth(income('old','工资',{date:'2026-09-01T00:00:00Z'}),'2026-10'),false);
});

test('disable and re-enable retain watermark but do not backfill the paused months',()=>{
  const october=run();
  const off=prepareRecurringSalarySettings(october.settings,{...october.settings,autoIncome:{...october.settings.autoIncome,enabled:false}},'2026-10-25');
  assert.equal(run(off,october.transactions,'2026-12-01').added.length,0);
  const on=prepareRecurringSalarySettings(off,{...off,autoIncome:{...off.autoIncome,enabled:true,startDate:'2020-01-01',lastProcessedMonth:null}},'2026-12-05');
  assert.deepEqual(on.autoIncome,{enabled:true,startDate:'2026-12-05',lastProcessedMonth:'2026-10'});
  const december=run(on,october.transactions,'2026-12-20');
  assert.deepEqual(december.added.map(tx=>tx.date),['2026-12-20']);
  assert.equal(december.transactions.some(tx=>tx.autoSalary?.month==='2026-11'),false);
});

test('stale editor watermark cannot rewind or fast-forward durable processing and turning on the budget restarts from today',()=>{
  const october=run().settings;
  const request={...october,autoIncome:{enabled:true,startDate:'1900-01-01',lastProcessedMonth:'2099-12'}};
  const protectedSettings=prepareRecurringSalarySettings(october,request,'2026-10-27');
  assert.deepEqual(protectedSettings.autoIncome,october.autoIncome);
  const budgetOff={...october,enabled:false};
  const resumed=prepareRecurringSalarySettings(budgetOff,{...budgetOff,enabled:true},'2026-12-21');
  assert.equal(resumed.autoIncome.startDate,'2026-12-21');assert.equal(resumed.autoIncome.lastProcessedMonth,'2026-10');
  assert.equal(run(resumed,[],'2026-12-21').added.length,0);
});

test('processing old configuration before editing preserves old amounts and changes only future due wages',()=>{
  const old=settings({autoIncome:{enabled:true,startDate:'2026-09-01',lastProcessedMonth:null}});
  const settled=run(old,[],'2026-10-27');
  assert.deepEqual(settled.added.map(tx=>tx.amount),[7000,7000]);
  const requested={...settled.settings,expectedSalary:8000,amounts:{消费:5600,浪费:400,投资:2000}};
  const next=prepareRecurringSalarySettings(settled.settings,requested,'2026-10-27');
  assert.equal(run(next,settled.transactions,'2026-10-27').added.length,0);
  const november=run(next,settled.transactions,'2026-11-20');
  assert.deepEqual(november.added.map(tx=>tx.amount),[8000]);
  assert.deepEqual(november.transactions.filter(tx=>tx.date<'2026-11-01').map(tx=>tx.amount),[7000,7000]);
});

test('a one-period budget override never changes automatically recorded salary',()=>{
  const config=settings({periodOverride:{startDate:'2026-10-01',endDate:'2026-10-31',salary:8000}});
  assert.equal(calculateSalaryBudget(config,[],'2026-10-20').baseFen,800000);
  assert.equal(run(config).added[0].amount,7000);
});

test('invalid recurrence configuration and metadata are rejected while editable actual dates remain valid',()=>{
  for(const autoIncome of [
    {enabled:true,startDate:'bad',lastProcessedMonth:null},
    {enabled:true,startDate:'2026-10-01',lastProcessedMonth:'2026-13'},
    {enabled:true,startDate:'2026-10-01',lastProcessedMonth:'2026-10',extra:1},
    {enabled:'yes',startDate:'2026-10-01',lastProcessedMonth:null},
  ])assert.throws(()=>normalizeSalaryBudgetSettings(settings({autoIncome})));
  assert.throws(()=>normalizeSalaryBudgetSettings(settings({salaryDay:null})));
  assert.throws(()=>normalizeSalaryBudgetSettings(settings({expectedSalary:0,amounts:{消费:0,浪费:0,投资:0}})));
  const generated=run().added[0];
  assert.deepEqual(normalizeTransaction({...generated,date:'2026-11-02'}).autoSalary,generated.autoSalary);
  assert.throws(()=>normalizeTransaction({...generated,type:'expense',nature:'消费',spendKind:'variable'}),/标记/);
  assert.throws(()=>normalizeTransaction({...generated,autoSalary:{month:'2026-11',scheduledDate:'2026-10-20'}}),/月份/);
  assert.throws(()=>normalizeTransaction({...generated,autoSalary:{...generated.autoSalary,extra:true}}),/标记/);
});

test('three-book backup preserves exact amounts, watermarks and generated salary provenance independently',()=>{
  const personal=run(),family=run(settings({expectedSalary:9000,amounts:{消费:6000,浪费:0,投资:2000}}));
  const state={...defaultState(),salaryBudget:personal.settings,transactions:personal.transactions};
  state.otherLedgers.family.salaryBudget=family.settings;state.otherLedgers.family.transactions=family.transactions;
  const restored=normalizeBackup(JSON.parse(JSON.stringify(encodeBackup(state))));
  assert.deepEqual(restored,state);
  assert.equal(restored.salaryBudget.autoIncome.lastProcessedMonth,'2026-10');
  assert.equal(restored.otherLedgers.family.transactions[0].amount,9000);
  assert.equal(restored.otherLedgers.travel.salaryBudget,null);
  assert.equal(run(restored.salaryBudget,restored.transactions).added.length,0);
});

test('capacity overflow fails the entire proposed catch-up without altering input watermark or transactions',()=>{
  const full=Array.from({length:5000},(_,i)=>income('existing-'+i,'报销',{date:'2026-01-01'}));
  const config=settings(),before=structuredClone(config);
  assert.throws(()=>run(config,full),/5000/);
  assert.deepEqual(config,before);assert.equal(full.length,5000);
  const withManual=[...full.slice(0,-1),income('manual')];
  const skipped=run(config,withManual);
  assert.equal(skipped.transactions.length,5000);assert.equal(skipped.added.length,0);
  assert.equal(skipped.settings.autoIncome.lastProcessedMonth,'2026-10');
});

test('exact amount settings round-trip cents, take precedence over old ratios, and scale without display rounding',()=>{
  const config=settings({expectedSalary:7000,amounts:{消费:4888.88,浪费:0.01,投资:1750.03}});
  const normalized=normalizeSalaryBudgetSettings(config),result=calculateSalaryBudget(normalized,[],'2026-10-20');
  assert.deepEqual(result.rows.map(row=>row.budgetFen),[488888,1,175003]);
  assert.equal(result.unallocatedFen,36108);
  assert.deepEqual(allocateSalaryBudgetAmounts(0.03,{消费:0.01,浪费:0,投资:0.02},0.07),
    {baseFen:7,amountsFen:{消费:2,浪费:0,投资:5},unallocatedFen:0});
  assert.deepEqual(allocateSalaryBudgetAmounts(0,{消费:0,浪费:0,投资:0},100),
    {baseFen:10000,amountsFen:{消费:0,浪费:0,投资:0},unallocatedFen:10000});
  assert.throws(()=>normalizeSalaryBudgetSettings(settings({amounts:{消费:7000,浪费:0.01,投资:0}})),/合计/);
  assert.throws(()=>normalizeSalaryBudgetSettings(settings({amounts:{消费:0.001,浪费:0,投资:0}})));
});
