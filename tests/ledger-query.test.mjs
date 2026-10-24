import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, defaultLedgerData } from '../lib/data/schema.ts';
import { resolveLedgerQuery, validateQueryPlan, executeLedgerQuery, MAX_QUERY_DAYS } from '../lib/domain/ledger-query.ts';

const range=(startDate,endDate)=>({startDate,endDate});
const context={today:'2026-10-24',defaultRange:range('2026-10-01','2026-10-31'),ledgerKind:'personal'};
const plan=(patch={})=>({range:context.defaultRange,type:'expense',metric:'total',...patch});
const tx=(id,date,amount,extra={})=>({id,date,amount,type:'expense',category:'餐饮',nature:'消费',note:'仅本机的私密备注',icon:'餐',source:'text',cycleId:null,spendKind:'variable',...extra});
const resolved=(text,ctx=context)=>{const result=resolveLedgerQuery(text,ctx);assert.equal(result.kind,'query',`${text}: ${JSON.stringify(result)}`);return result.plan;};

test('query grammar distinguishes questions and follow-ups from new ledger entries or write commands',()=>{
  for(const text of ['昨天午饭35元','今天工资到账8000元','奶茶20，这笔算浪费','收入8000支出35','帮我记一笔昨天午饭35元','删除这笔账，多少钱都删除','']) assert.equal(resolveLedgerQuery(text,context).kind,'none',text);
  assert.equal(resolveLedgerQuery('那旅行账本呢',context).kind,'clarification');
  const query=resolved('上个月吃饭花了多少钱？');
  assert.deepEqual(query,{range:range('2026-09-01','2026-09-30'),ledgerKind:'personal',type:'expense',metric:'total',categories:['餐饮']});
});

test('follow-ups preserve category, nature and range unless the user explicitly replaces a condition',()=>{
  const first=resolved('上个月吃饭花多少');
  const comparison=resolved('跟前一个月比呢',{...context,previousQuery:first});
  assert.deepEqual(comparison,{...first,comparison:'previous_month'});
  const family=resolved('只看家庭账本',{...context,previousQuery:comparison});
  assert.deepEqual(family,{...comparison,ledgerKind:'family'});
  const travel=resolved('那旅行账本呢',{...context,previousQuery:family});
  assert.deepEqual(travel,{...family,ledgerKind:'travel'});
  const transport=resolved('那交通呢',{...context,previousQuery:first});
  assert.deepEqual(transport,{...first,categories:['交通']});
  const income=resolved('那收入呢',{...context,previousQuery:{...first,natures:['消费']}});
  assert.equal(income.type,'income');assert.equal(income.categories,undefined);assert.equal(income.natures,undefined);
  assert.deepEqual(first.categories,['餐饮'],'previous query is immutable');
});

test('calendar grammar handles prior month across years and leap years without device timezone arithmetic',()=>{
  const january={...context,today:'2026-01-02'};
  assert.deepEqual(resolved('上个月支出多少',january).range,range('2025-12-01','2025-12-31'));
  assert.deepEqual(resolved('上个月支出多少',{...context,today:'2024-03-05'}).range,range('2024-02-01','2024-02-29'));
  assert.deepEqual(resolved('上个月支出多少',{...context,today:'2025-03-05'}).range,range('2025-02-01','2025-02-28'));
  assert.deepEqual(resolved('今年收入多少').range,range('2026-01-01','2026-12-31'));
  assert.deepEqual(resolved('去年支出多少').range,range('2025-01-01','2025-12-31'));
});

test('week uses Monday through Sunday and recent days include today exactly once',()=>{
  assert.deepEqual(resolved('上周支出多少').range,range('2026-10-12','2026-10-18'));
  assert.deepEqual(resolved('本周支出多少').range,range('2026-10-19','2026-10-25'));
  assert.deepEqual(resolved('最近7天支出多少').range,range('2026-10-18','2026-10-24'));
  assert.deepEqual(resolved('最近1天支出多少').range,range('2026-10-24','2026-10-24'));
  assert.deepEqual(resolved('上周支出多少',{...context,today:'2026-01-01'}).range,range('2025-12-22','2025-12-28'));
});

test('month-to-date phrases end at today while an unqualified calendar month remains complete',()=>{
  for(const text of ['本月截至今天花多少钱','这个月到今天支出多少','这月截至今天餐饮花多少']) {
    assert.deepEqual(resolved(text).range,range('2026-10-01','2026-10-24'));
  }
  assert.equal(resolved('这个月到今天收入多少').type,'income');
  assert.deepEqual(resolved('本月截至今天支出多少',{...context,today:'2024-02-29'}).range,range('2024-02-01','2024-02-29'));
  assert.deepEqual(resolved('这个月到今天支出多少',{...context,today:'2026-01-01'}).range,range('2026-01-01','2026-01-01'));
  assert.deepEqual(resolved('本月支出多少').range,range('2026-10-01','2026-10-31'));
  const state=defaultState();
  state.transactions=[tx('before','2026-09-30',50),tx('first','2026-10-01',0.1),tx('today','2026-10-24',0.2),tx('tomorrow','2026-10-25',999)];
  const result=executeLedgerQuery(resolved('本月截至今天花多少钱'),state);
  assert.equal(result.summary.expense,0.3);assert.equal(result.summary.transactionCount,2);
  for(const text of ['上个月到今天支出多少','本月截至今天和昨天支出多少']) assert.equal(resolveLedgerQuery(text,context).kind,'clarification',text);
});

test('explicit date/month ranges are inclusive, keep stated years and never guess a cross-year wrap',()=>{
  assert.deepEqual(resolved('10月1日到10月15日支出多少').range,range('2026-10-01','2026-10-15'));
  assert.deepEqual(resolved('2025年12月到2026年1月支出多少').range,range('2025-12-01','2026-01-31'));
  assert.deepEqual(resolved('2025-12-31至2026-01-01支出多少').range,range('2025-12-31','2026-01-01'));
  assert.deepEqual(resolved('2024年2月29日支出多少').range,range('2024-02-29','2024-02-29'));
  assert.deepEqual(resolved('12月支出多少').range,range('2026-12-01','2026-12-31'),'yearless month is explicitly the year of today, even if future');
  for(const text of ['12月到1月支出多少','2025年2月29日支出多少','13月支出多少','2026-02-30支出多少','最近0天支出多少','今年去年收入多少']) assert.equal(resolveLedgerQuery(text,context).kind,'clarification',text);
});

test('unsupported subjects, ambiguous dates, combined ledgers and account-value questions are clarified',()=>{
  for(const text of ['最近几天花多少','上季度花多少','前几天收入多少','双十一花多少','今年10月花多少','所有账本支出多少','个人账本和家庭账本支出多少','午饭花多少','淘宝花多少','备注里有医院的支出多少','不看餐饮，只看交通花多少','投资收益多少','账户余额多少','上个月超支多少']) assert.equal(resolveLedgerQuery(text,context).kind,'clarification',text);
  assert.equal(resolveLedgerQuery('跟前一个月比呢',context).kind,'clarification');
  assert.equal(resolveLedgerQuery('跟前一个月比呢',{...context,previousQuery:plan({range:range('2026-10-01','2026-10-15')})}).kind,'clarification');
});

test('query category and expense nature remain separate dimensions, including count and breakdown',()=>{
  const query=resolved('上个月餐饮消费有几笔');
  assert.equal(query.type,'expense');assert.equal(query.metric,'count');assert.deepEqual(query.categories,['餐饮']);assert.deepEqual(query.natures,['消费']);
  const byCategory=resolved('上个月按分类统计支出');assert.equal(byCategory.metric,'breakdown');assert.equal(byCategory.breakdownBy,'category');
  const byNature=resolved('上个月消费和浪费分别多少钱');assert.equal(byNature.metric,'breakdown');assert.equal(byNature.breakdownBy,'nature');assert.deepEqual(byNature.natures,['消费','浪费']);
  assert.equal(resolveLedgerQuery('投资收入多少',context).kind,'clarification');
});

test('query validator is strict for model-returned plans and bounded in dates, enums and filter cardinality',()=>{
  assert.equal(validateQueryPlan(plan()),true);
  assert.equal(validateQueryPlan(plan({metric:'breakdown'})),true,'missing breakdownBy means category');
  const invalid=[
    {...plan(),sql:'SELECT *'}, {...plan(),ownerId:'other'}, {...plan(),script:'return 1'}, {...plan(),ledgerKind:'all'},
    {...plan(),range:{...context.defaultRange,timezone:'UTC'}}, {...plan(),range:range('2026-02-30','2026-03-01')},
    {...plan(),range:range('2026-10-02','2026-10-01')}, {...plan(),range:range('1900-01-01','9998-12-31')},
    {...plan(),categories:[]}, {...plan(),categories:['餐饮','餐饮']}, {...plan(),categories:['私有字段']},
    {...plan(),natures:['餐饮']}, {...plan(),natures:['消费'],type:'income'}, {...plan(),natures:['消费'],type:'all'},
    {...plan(),categories:['餐饮'],type:'income'}, {...plan(),categories:['收入']},
    {...plan(),breakdownBy:'nature'}, {...plan(),metric:'breakdown',breakdownBy:'nature',type:'all'},
    {...plan(),comparison:'arbitrary'}, {...plan(),range:range('2026-10-01','2026-10-15'),comparison:'previous_month'},
    {...plan(),range:range('1900-01-01','1900-01-31'),comparison:'previous_month'},
    {...plan(),type:{toString:()=> 'expense'}}, {...plan(),metric:null},
  ];
  for(const value of invalid) assert.equal(validateQueryPlan(value),false,JSON.stringify(value));
  assert.equal(MAX_QUERY_DAYS,3660);
});

function fixture() {
  const state=defaultState();
  state.transactions=[tx('start','2026-09-01',0.1),tx('end','2026-09-30',0.2,{nature:'浪费'}),tx('outside','2026-10-01',999),tx('transport','2026-09-15',2,{category:'交通'}),
    tx('invest','2026-09-20',100,{nature:'投资',category:'学习'}),tx('unclassified','2026-09-20',3,{nature:null}),
    tx('income','2026-09-20',200,{type:'income',category:'收入',nature:null,spendKind:null}),tx('prior','2026-08-31',0.2)];
  state.otherLedgers.family={...defaultLedgerData(),transactions:[tx('start','2026-09-01',500)]};
  state.otherLedgers.travel={...defaultLedgerData(),transactions:[tx('start','2026-09-01',750)]};
  return state;
}

test('execution uses actual date boundaries and integer fen, never budget funds, investment flows or market values',()=>{
  const state=fixture();state.settings.monthlyBudget=90000;
  state.investmentAccounts=[{id:'asset',name:'private-account',openingNetContribution:10000,currentMarketValue:15000,marketValueUpdatedAt:'2026-09-30',createdAt:'2026-09-01'}];
  state.investmentFlows=[{id:'private-flow',accountId:'asset',type:'withdrawal',amount:10000,date:'2026-09-01',cycleId:null}];
  const before=structuredClone(state),query=resolved('上个月吃饭花多少'),result=executeLedgerQuery(query,state);
  assert.equal(result.summary.expense,3.3);assert.equal(result.summary.transactionCount,3);
  assert.match(result.answer,/2026-09-01 至 2026-09-30/);assert.match(result.answer,/分类：餐饮/);assert.match(result.answer,/支出3.3元/);
  assert.deepEqual(state,before);assert.deepEqual(result.plan,query);
  for(const privateText of ['仅本机的私密备注','private-account','private-flow','90000','15000']) assert.equal(JSON.stringify(result).includes(privateText),false);
});

test('same IDs in three books remain isolated and the query never changes the active book or owner state',()=>{
  const state=fixture(),before=structuredClone(state);
  for(const [kind,amount] of [['personal',105.3],['family',500],['travel',750]]) {
    const result=executeLedgerQuery(plan({range:range('2026-09-01','2026-09-30'),ledgerKind:kind}),state);
    assert.equal(result.summary.expense,amount);assert.equal(result.ledgerKind,kind);assert.ok(result.facts.includes(`ledger:${kind}`));
  }
  assert.deepEqual(state,before);assert.equal(state.ledgerKind,'personal');
  const anotherOwner=defaultState();assert.equal(executeLedgerQuery(plan({range:range('2026-09-01','2026-09-30'),ledgerKind:'family'}),anotherOwner).summary.expense,0);
  delete state.otherLedgers.family;assert.throws(()=>executeLedgerQuery(plan({ledgerKind:'family'}),state),/不存在/);
});

test('expense nature filters do not become categories or claim investment returns',()=>{
  const state=fixture();
  const waste=executeLedgerQuery(resolved('上个月餐饮浪费花多少'),state);assert.equal(waste.summary.expense,0.2);
  const consumption=executeLedgerQuery(resolved('上个月消费多少'),state);assert.equal(consumption.summary.expense,2.1);
  const investment=executeLedgerQuery(resolved('上个月投资支出多少'),state);assert.equal(investment.summary.expense,100);assert.match(investment.answer,/不表示投资收益/);
  const unclassified=executeLedgerQuery(resolved('上个月未分类支出多少'),state);assert.equal(unclassified.summary.expense,3);
});

test('breakdowns and counts are reconstructable from facts without notes or transaction IDs',()=>{
  const state=fixture(),byCategory=executeLedgerQuery(resolved('上个月按分类统计支出'),state);
  assert.deepEqual(Object.fromEntries(byCategory.breakdown.map(row=>[row.label,row.summary.expense])),{交通:2,学习:100,餐饮:3.3});
  assert.ok(byCategory.facts.includes('breakdown["餐饮"].expense:3.3'));
  const byNature=executeLedgerQuery(resolved('上个月按性质统计支出'),state);
  assert.deepEqual(Object.fromEntries(byNature.breakdown.map(row=>[row.label,row.summary.expense])),{消费:2.1,浪费:0.2,投资:100,未分类:3});
  const count=executeLedgerQuery(resolved('上个月吃饭有几笔'),state);assert.equal(count.summary.transactionCount,3);assert.match(count.answer,/支出3笔/);
});

test('previous month comparison uses complete calendar months across leap and year boundaries',()=>{
  const state=fixture(),first=resolved('上个月吃饭花多少'),query=resolved('跟前一个月比呢',{...context,previousQuery:first});
  const result=executeLedgerQuery(query,state);
  assert.deepEqual(result.comparison.range,range('2026-08-01','2026-08-31'));assert.equal(result.comparison.summary.expense,0.2);assert.equal(result.comparison.delta.expense,3.1);
  assert.match(result.answer,/前一个完整月/);assert.ok(result.facts.includes('delta.expense:3.1'));
  assert.deepEqual(executeLedgerQuery(plan({range:range('2024-03-01','2024-03-31'),comparison:'previous_month'}),state).comparison.range,range('2024-02-01','2024-02-29'));
  assert.deepEqual(executeLedgerQuery(plan({range:range('2026-01-01','2026-01-31'),comparison:'previous_month'}),state).comparison.range,range('2025-12-01','2025-12-31'));
});

test('previous period is explicitly an adjacent equal-length date interval, never a fabricated salary cycle',()=>{
  const query=resolved('跟上一周期比呢',{...context,previousQuery:plan({range:range('2026-01-01','2026-01-07')})});
  const result=executeLedgerQuery(query,fixture());assert.deepEqual(result.comparison.range,range('2025-12-25','2025-12-31'));
  assert.match(result.answer,/上一等长时段/);assert.doesNotMatch(result.answer,/上个发薪周期/);
  assert.match(result.answer,/对照时段没有匹配的现有记录/);
});

test('all-flow answers label net recorded balance correctly, with no unsupported percentage or budget claim',()=>{
  const result=executeLedgerQuery(resolved('上个月收支情况'),fixture());
  assert.equal(result.summary.income,200);assert.equal(result.summary.expense,105.3);assert.equal(result.summary.balance,94.7);
  assert.match(result.answer,/账面收支结余94.7元/);assert.match(result.answer,/不代表账户余额或可用预算/);assert.doesNotMatch(result.answer,/%|超支/);
});

test('empty matches and old uncertain timestamps receive honest scope-specific explanations',()=>{
  const state=fixture(),empty=executeLedgerQuery(plan({range:range('2020-01-01','2020-01-31')}),state);
  assert.equal(empty.summary.expense,0);assert.match(empty.answer,/这个范围内没有匹配的现有记录/);assert.doesNotMatch(empty.answer,/整个账本没有/);
  const prior=process.env.TZ;
  try { process.env.TZ='Asia/Hong_Kong';state.transactions=[tx('legacy','2026-09-30T16:30:00Z',1,{dateNeedsConfirmation:true})];
    const result=executeLedgerQuery(plan({range:range('2026-10-01','2026-10-01')}),state);assert.equal(result.summary.pendingDateCount,1);assert.match(result.answer,/本机日期统计/);
  } finally { if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior; }
});

test('invalid plans and monetary overflows fail before returning fabricated results',()=>{
  assert.throws(()=>executeLedgerQuery({...plan(),sql:'any'},fixture()),/计划无效/);
  const state=defaultState();state.transactions=Array.from({length:91},(_,i)=>tx(String(i),'2026-10-01',999999999999.99));
  assert.throws(()=>executeLedgerQuery(plan(),state),/合计超过/);
  state.transactions=[tx('invalid','2026-10-01',0.001)];assert.throws(()=>executeLedgerQuery(plan(),state),/金额需/);
  state.transactions=[...Array.from({length:90},(_,i)=>tx(`income-${i}`,'2026-10-01',999999999999.99,{type:'income',nature:null,spendKind:null})),...Array.from({length:90},(_,i)=>tx(`expense-${i}`,'2026-09-01',999999999999.99))];
  assert.throws(()=>executeLedgerQuery(plan({type:'all',comparison:'previous_month'}),state),/对比金额超出/,'each interval fits but the difference of opposite net balances must still reject overflow');
  assert.equal(resolveLedgerQuery('上个月花多少',{...context,today:'bad'}).kind,'clarification');
  assert.equal(resolveLedgerQuery('那交通呢',{...context,previousQuery:{...plan(),sql:'x'}}).kind,'clarification');
});
