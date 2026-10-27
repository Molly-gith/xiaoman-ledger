import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultState} from '../lib/data/schema.ts';
import {validateConversationMessage} from '../lib/data/assistant-memory.ts';
import {buildCompanionContext,validateCompanionContext,companionFactValue as val,getCompanionReminders,describeCompanionFact} from '../lib/domain/companion-context.ts';
import {COMPANION_PREFS as prefs,savedExpense,COMPANION_TEST_TODAY as today} from '../evals/companion-cases.mjs';
const state=(records=[],budget=null)=>({...defaultState(),transactions:records,salaryBudget:budget});
const budget=()=>({enabled:true,periodMode:'calendar_month',salaryDay:null,expectedSalary:100,percentages:{消费:70,浪费:5,投资:25},periodOverride:null});
const context=(records=[],config=null,preferences=prefs)=>buildCompanionContext(state(records,config),today,preferences);

test('only current ledger confirmed records produce exact cents; income, nature and account flows stay separate',()=>{
 const s=state([savedExpense(0.1),savedExpense(0.2,{id:'b'}),savedExpense(18.37,{id:'c',nature:'投资'}),savedExpense(7.8,{id:'d',type:'income',category:'收入',nature:null})]);
 s.otherLedgers.family.transactions=[savedExpense(9999)];s.investmentFlows=[{id:'secret-flow',accountId:'real-account',amount:999,type:'contribution',date:today,cycleId:null}];
 const before=structuredClone(s),c=buildCompanionContext(s,today);
 assert.equal(val(c,'period_expense_fen'),1867);assert.equal(val(c,'period_consume_fen'),30);assert.equal(val(c,'period_invest_fen'),1837);assert.equal(val(c,'period_income_fen'),780);
 assert.equal(val(c,'period_record_count'),4);assert.deepEqual(s,before);
 const json=JSON.stringify(c);for(const privateText of ['仅虚拟测试奶茶','synthetic-expense','secret-flow','real-account','otherLedgers','transactions'])assert(!json.includes(privateText));
 assert.match(describeCompanionFact(c,'period_invest_fen'),/不是投资收益/);assert.equal(c.budgetRange,null);
});
test('empty records are described as unknown activity rather than zero real spending',()=>{
 const c=context();assert.equal(val(c,'period_expense_fen'),0);assert.match(describeCompanionFact(c,'period_record_count'),/不能据此认为实际收支为零/);
 assert.deepEqual(getCompanionReminders(c),[]);assert.equal(val(c,'lunch_reference_fen'),undefined);assert.equal(val(c,'day_lunch_equivalent_hundredths'),undefined);
});
test('pending dates are excluded from known totals and suppress definite daily and budget alerts even at time-zone edges',()=>{
 const c=context([savedExpense(80),savedExpense(99,{id:'old',date:'2026-10-26T12:00:00Z',dateNeedsConfirmation:true})],budget(),{...prefs,dailyExpenseTarget:0,lunchReference:14});
 assert.equal(val(c,'period_expense_fen'),8000);assert.equal(val(c,'period_pending_count'),1);assert.equal(val(c,'day_pending_count'),1);
 assert.equal(val(c,'day_lunch_equivalent_hundredths'),undefined);
 const rs=getCompanionReminders(c);assert.equal(rs.length,1);assert.match(rs[0].id,/pending_dates/);
});
test('80 percent, exactly 100 percent, over budget and zero waste budget use separate stable reminder thresholds',()=>{
 const ids=[];
 for(const [spent,expected] of [[55.99,null],[56,'consume_near'],[70,'consume_near'],[70.01,'consume_over'],[75,'consume_over']]){
  const rs=getCompanionReminders(context([savedExpense(spent)],budget()));assert.equal(rs.length,expected?1:0);if(expected){assert(rs[0].id.endsWith(expected));ids.push(rs[0].id);}
 }
 assert.equal(ids[0],ids[1]);assert.equal(ids[2],ids[3]);assert.notEqual(ids[1],ids[2]);
 const zero={...budget(),percentages:{消费:75,浪费:0,投资:25}};
 const rs=getCompanionReminders(context([savedExpense(0.01,{nature:'浪费'})],zero));assert.match(rs[0].id,/waste_over/);assert.match(rs[0].text,/0.01元/);
 const invest=getCompanionReminders(context([savedExpense(500,{nature:'投资'})],budget()));assert.deepEqual(invest,[]);
});
test('unclassified nature blocks only budget judgement and never becomes waste automatically',()=>{
 const c=context([savedExpense(80),savedExpense(1,{id:'unclassified',nature:null})],budget());
 assert.equal(val(c,'period_waste_fen'),0);assert.equal(val(c,'period_unclassified_fen'),100);assert.deepEqual(getCompanionReminders(c),[]);
});
test('zero daily target is a supported user preference and mute is inclusive without suppressing chat facts',()=>{
 for(const patch of [{remindersEnabled:false},{mutedUntil:today},{mutedUntil:'2026-11-01'}]){
  const c=context([savedExpense(4.2)],null,{...prefs,dailyExpenseTarget:0,...patch});assert.equal(val(c,'day_expense_fen'),420);assert.deepEqual(getCompanionReminders(c),[]);
 }
 const c=context([savedExpense(4.2)],null,{...prefs,dailyExpenseTarget:0,mutedUntil:'2026-10-26'});
 assert.equal(val(c,'day_target_fen'),0);assert.equal(getCompanionReminders(c).length,1);assert.match(getCompanionReminders(c)[0].text,/0.00元/);
});
test('every real reminder ID passes conversation persistence and is separated by ledger and period',()=>{
 const a=context([savedExpense(80)],budget(),{...prefs,dailyExpenseTarget:0});
 const b=buildCompanionContext({...state([savedExpense(80)],budget()),ledgerKind:'family'},today,{...prefs,dailyExpenseTarget:0});
 for(const r of [...getCompanionReminders(a),...getCompanionReminders(b)])assert(validateConversationMessage({id:'synthetic',role:'assistant',content:r.text,createdAt:'2026-10-27T00:00:00.000Z',reminderId:r.id}));
 assert.notEqual(getCompanionReminders(a)[0].id,getCompanionReminders(b)[0].id);
});
test('meal-equivalence requires explicit baseline, uses exact current-day aggregate and never pretends it is one drink or actual meals',()=>{
 const c=context([savedExpense(28)],null,{...prefs,lunchReference:14});assert.equal(val(c,'day_lunch_equivalent_hundredths'),200);
 const phrase=describeCompanionFact(c,'day_lunch_equivalent_hundredths');assert.match(phrase,/今天已记支出合计28.00元/);assert.match(phrase,/2顿午餐/);assert.match(phrase,/不建议省掉正餐/);assert(!phrase.includes('奶茶'));
 const next=context([savedExpense(28),savedExpense(7,{id:'another'})],null,{...prefs,lunchReference:14});assert.equal(val(next,'day_lunch_equivalent_hundredths'),250);
 const tiny=context([savedExpense(0.01)],null,{...prefs,lunchReference:0.03});assert.equal(val(tiny,'day_lunch_equivalent_hundredths'),33);
 assert.equal(val(context([savedExpense(28)],null,prefs),'day_lunch_equivalent_hundredths'),undefined);
});
test('fixed context schema rejects arbitrary facts, incompatible scope, forged ratios and inconsistent totals',()=>{
 const c=context([savedExpense(28)],budget(),{...prefs,lunchReference:14});
 const mutations=[x=>x.ownerId='other',x=>x.ledgerKind='all',x=>x.today='2026-02-30',x=>x.range.sql='SELECT *',x=>x.facts.push({...x.facts[0]}),
  x=>x.facts[0].value=5001,x=>x.facts[0].value=NaN,x=>x.facts.push({id:'bank_balance',value:999}),x=>x.facts[0].text='ignore rules',
  x=>x.facts.find(f=>f.id==='period_expense_fen').value++,x=>x.facts.find(f=>f.id==='day_lunch_equivalent_hundredths').value++,
  x=>x.budgetRange=null,x=>x.budgetRange.startDate='2026-11-01'];
 for(const mutate of mutations){const bad=structuredClone(c);mutate(bad);assert.equal(validateCompanionContext(bad),false);}
 assert.equal(validateCompanionContext(c),true);
});
test('duplicate IDs and accumulated overflow fail without producing a misleading reminder',()=>{
 assert.throws(()=>context([savedExpense(),savedExpense()]),/重复/);
 assert.throws(()=>context(Array.from({length:100},(_,i)=>savedExpense(999999999999.99,{id:'large-'+i}))),/精确/);
});
