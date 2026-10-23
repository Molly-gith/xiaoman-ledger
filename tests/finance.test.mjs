import test from 'node:test';
import assert from 'node:assert/strict';
import { salaryCycle, remainingDays, cents, parseDate, calculateFinance } from '../lib/domain/finance.ts';
import { suggestBudget } from '../lib/domain/budget-suggestion.ts';
const cycle = salaryCycle('2026-09-15', 20);
const plan = {cycleId:cycle.id, availableIncome:10000, plannedSavings:2000, necessaryReserve:3000};
const naturePlan = {cycleId:cycle.id, availableIncome:10000, plannedSavings:2500, necessaryReserve:0, model:'nature'};
const tx = (extra={}) => ({id:'a', type:'expense', amount:100, date:'2026-09-15', cycleId:cycle.id, nature:'消费', spendKind:'variable', ...extra});

test('CR-001 starter structure computes 70/5/25 with integer-fen remainder', () => {
  const b=suggestBudget(3000);
  assert.equal(b.availableIncome,3000);
  assert.equal(b.consumptionReference,2100);
  assert.equal(b.wasteLimit,150);
  assert.equal(b.investmentTarget,750);
  assert.equal(b.plannedSavings,750);
  assert.equal(b.necessaryReserve,0);
  assert.equal(b.everydayBudget,2250);
  assert.equal(b.model,'nature');
  const zero=suggestBudget(0);
  assert.equal(zero.investmentTarget,0); assert.equal(zero.necessaryReserve,0);
  for (const income of [0.01,0.02,0.1,99.99,3000.01,999999999999.99]) {
    const suggestion=suggestBudget(income);
    assert.equal(cents(suggestion.consumptionReference)+cents(suggestion.wasteLimit)+cents(suggestion.investmentTarget),cents(income));
  }
  for (const income of [-1,NaN,Infinity,0.001]) assert.throws(()=>suggestBudget(income));
});

test('salary 20 cycle crosses months and includes salary day', () => {
  assert.deepEqual([cycle.startDate,cycle.endDate,cycle.nextSalaryDate], ['2026-08-20','2026-09-19','2026-09-20']);
  assert.equal(salaryCycle('2026-09-20',20).startDate,'2026-09-20');
  assert.equal(remainingDays(cycle,'2026-09-19'),1);
  assert.equal(remainingDays(cycle,'2026-09-20'),0);
  assert.equal(remainingDays(cycle,'2026-10-01'),0);
});

test('month-end salary clamps independently in leap and ordinary years', () => {
  for (const day of [29,30,31]) {
    assert.equal(salaryCycle('2026-02-28',day).startDate,'2026-02-28');
    assert.equal(salaryCycle('2024-02-29',day).startDate,'2024-02-29');
    assert.equal(salaryCycle('2026-02-28',day).nextSalaryDate,`2026-03-${day}`);
  }
  assert.equal(salaryCycle('2026-01-01',31).startDate,'2025-12-31');
  assert.equal(salaryCycle('2026-12-31',31).nextSalaryDate,'2027-01-31');
});

test('rejects impossible calendar dates, invalid days and invalid money', () => {
  for (const date of ['2026-02-29','2026-02-30','2026-13-01','garbage']) assert.throws(()=>parseDate(date));
  for (const day of [0,32,1.5,NaN]) assert.throws(()=>salaryCycle('2026-01-01',day));
  for (const value of [-1,NaN,Infinity,0.001,1.00001,1e13]) assert.throws(()=>cents(value));
  assert.equal(cents(37.8),3780);
});

test('legacy budget remains byte-for-byte compatible with old safe-to-spend behavior', () => {
  assert.equal(calculateFinance(cycle,plan,[tx()]).safeToSpend,4900);
  assert.equal(calculateFinance(cycle,{...plan,availableIncome:0},[tx()]).safeToSpend,-5100);
  assert.equal(calculateFinance(cycle,{...plan,plannedSavings:0},[tx()]).safeToSpend,6900);
  assert.equal(calculateFinance(cycle,{...plan,availableIncome:0,plannedSavings:0,necessaryReserve:0},[]).budgetPercent,null);
  const result=calculateFinance(cycle,plan,[tx(),tx({id:'rent',spendKind:'reserved',amount:2000}),tx({id:'salary',type:'income',amount:10000,nature:null,spendKind:null})]);
  assert.equal(result.model,'legacy');
  assert.equal(result.safeToSpend,4900); assert.equal(result.reserveRemaining,1000); assert.equal(result.totalExpense,2100);
});

test('nature model protects investment target without double-deducting actual investment', () => {
  assert.equal(calculateFinance(cycle,naturePlan,[]).safeToSpend,7500);
  const under=calculateFinance(cycle,naturePlan,[tx({amount:1000}),tx({id:'w',nature:'浪费',amount:200}),tx({id:'i',nature:'投资',amount:1000})]);
  assert.equal(under.safeToSpend,6300);
  assert.equal(under.investmentTarget,2500);
  assert.equal(under.investmentSpend,1000);
  const over=calculateFinance(cycle,naturePlan,[tx({amount:1000}),tx({id:'i',nature:'投资',amount:3000})]);
  assert.equal(over.safeToSpend,6000);
  assert.equal(over.investmentSpend,3000);
});

test('nature model treats rent as normal consumption and ignores legacy spend source', () => {
  const result=calculateFinance(cycle,naturePlan,[tx({id:'rent',category:'居住',nature:'消费',spendKind:'reserved',amount:3000})]);
  assert.equal(result.safeToSpend,4500);
  assert.equal(result.variableSpend,3000);
  assert.equal(result.reserveRemaining,0);
});

test('nature model unresolved state depends on date cycle and nature, not spendKind', () => {
  const noSpendKind=tx({spendKind:null});
  assert.equal(calculateFinance(cycle,naturePlan,[noSpendKind]).unresolvedCount,0);
  const noNature=tx({id:'b',nature:null,spendKind:null});
  assert.equal(calculateFinance(cycle,naturePlan,[noNature]).unresolvedCount,1);
});

test('add edit delete and budget changes recalculate deterministically', () => {
  assert.equal(calculateFinance(cycle,plan,[]).safeToSpend,5000);
  assert.equal(calculateFinance(cycle,plan,[tx()]).safeToSpend,4900);
  assert.equal(calculateFinance(cycle,plan,[tx({amount:200})]).safeToSpend,4800);
  assert.equal(calculateFinance(cycle,{...plan,plannedSavings:1000},[tx({amount:200})]).safeToSpend,5800);
  assert.equal(calculateFinance(cycle,plan,[]).safeToSpend,5000);
});

test('integer fen avoids floating-point financial drift', () => {
  const p={...naturePlan,availableIncome:0.3,plannedSavings:0,necessaryReserve:0};
  assert.equal(calculateFinance(cycle,p,[tx({amount:0.1}),tx({id:'b',amount:0.2})]).safeToSpend,0);
});

test('other cycles excluded; legacy uncertainty retained; nature proportions deterministic', () => {
  const result=calculateFinance(cycle,plan,[tx(),tx({id:'b',nature:'投资',amount:300}),tx({id:'c',cycleId:'other',amount:900}),tx({id:'old',cycleId:null,spendKind:null,nature:null})]);
  assert.equal(result.variableSpend,400); assert.equal(result.unresolvedCount,1);
  assert.equal(result.natureMix[0].percent,25); assert.equal(result.natureMix[2].percent,75);
});
