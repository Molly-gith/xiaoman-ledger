import test from 'node:test';
import assert from 'node:assert/strict';
import { salaryCycle, remainingDays, cents, parseDate, calculateFinance } from '../lib/domain/finance.ts';
const cycle = salaryCycle('2026-09-15', 20);
const plan = {cycleId:cycle.id, availableIncome:10000, plannedSavings:2000, necessaryReserve:3000};
const tx = (extra={}) => ({id:'a', type:'expense', amount:100, date:'2026-09-15', cycleId:cycle.id, nature:'消费', spendKind:'variable', ...extra});
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
test('normal, zero income, zero savings and negative values follow the defined formula', () => {
  assert.equal(calculateFinance(cycle,plan,[tx()]).safeToSpend,4900);
  assert.equal(calculateFinance(cycle,{...plan,availableIncome:0},[tx()]).safeToSpend,-5100);
  assert.equal(calculateFinance(cycle,{...plan,plannedSavings:0},[tx()]).safeToSpend,6900);
  assert.equal(calculateFinance(cycle,{...plan,availableIncome:0,plannedSavings:0,necessaryReserve:0},[]).budgetPercent,null);
});
test('income and reserved spending are not subtracted or counted twice', () => {
  const result=calculateFinance(cycle,plan,[tx(),tx({id:'rent',spendKind:'reserved',amount:2000}),tx({id:'salary',type:'income',amount:10000,nature:null,spendKind:null})]);
  assert.equal(result.safeToSpend,4900); assert.equal(result.reserveRemaining,1000); assert.equal(result.totalExpense,2100);
});
test('add edit delete and budget changes recalculate deterministically', () => {
  assert.equal(calculateFinance(cycle,plan,[]).safeToSpend,5000);
  assert.equal(calculateFinance(cycle,plan,[tx()]).safeToSpend,4900);
  assert.equal(calculateFinance(cycle,plan,[tx({amount:200})]).safeToSpend,4800);
  assert.equal(calculateFinance(cycle,{...plan,plannedSavings:1000},[tx({amount:200})]).safeToSpend,5800);
  assert.equal(calculateFinance(cycle,plan,[]).safeToSpend,5000);
});
test('integer fen avoids floating-point financial drift', () => {
  const p={...plan,availableIncome:0.3,plannedSavings:0,necessaryReserve:0};
  assert.equal(calculateFinance(cycle,p,[tx({amount:0.1}),tx({id:'b',amount:0.2})]).safeToSpend,0);
});
test('other cycles excluded; legacy uncertainty retained; nature proportions deterministic', () => {
  const result=calculateFinance(cycle,plan,[tx(),tx({id:'b',nature:'投资',amount:300}),tx({id:'c',cycleId:'other',amount:900}),tx({id:'old',cycleId:null,spendKind:null,nature:null})]);
  assert.equal(result.variableSpend,400); assert.equal(result.unresolvedCount,1);
  assert.equal(result.natureMix[0].percent,25); assert.equal(result.natureMix[2].percent,75);
});
