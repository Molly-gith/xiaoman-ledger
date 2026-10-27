import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../lib/data/repository.ts';
import { defaultState } from '../lib/data/schema.ts';
const settings = (extra={}) => ({enabled:true,periodMode:'salary_based',salaryDay:15,expectedSalary:7000,percentages:{消费:70,浪费:5,投资:25},amounts:{消费:4900,浪费:350,投资:1750},periodOverride:null,autoIncome:{enabled:true,startDate:'2026-10-01',lastProcessedMonth:null},...extra});
function fixture(initial=defaultState()) {
 let value=structuredClone(initial), writes=0, fail=false, loseReply=false;
 const store={read:async()=>structuredClone(value),commit:async(next,revision)=>{
  if(value.revision!==revision)throw Error('stale');
  if(fail)throw Error('quota');
  value=structuredClone(next);writes++;if(loseReply){loseReply=false;throw Error('lost reply');}
 }};
 return {repo:createRepository(store),other:createRepository(store),read:store.read,writes:()=>writes,fail:()=>{fail=true;},loseReply:()=>{loseReply=true;}};
}
function seeded(config=settings()){return {...defaultState(),salaryBudget:config};}
test('payday work is atomic across tabs, and repeating or deleting cannot recreate the salary',async()=>{
 const f=fixture(seeded());
 assert.equal((await f.repo.ensureRecurringSalary('2026-10-14')).transactions.length,0);
 const both=await Promise.all([f.repo.ensureRecurringSalary('2026-10-15'),f.other.ensureRecurringSalary('2026-10-15')]);
 assert.equal(f.writes(),1);assert.deepEqual(both[0],both[1]);
 let state=await f.read();assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].amount,7000);
 assert.equal(state.salaryBudget.autoIncome.lastProcessedMonth,'2026-10');
 state=await f.repo.deleteTransaction(state.transactions[0].id,state.revision);
 const kept=await f.repo.ensureRecurringSalary('2026-10-31');assert.deepEqual(kept,state);
 const next=await f.repo.ensureRecurringSalary('2026-11-15');assert.equal(next.transactions.length,1);assert.equal(next.transactions[0].date,'2026-11-15');
});
test('all three books catch up their own paydays in one commit',async()=>{
 const initial=seeded();initial.otherLedgers.family.salaryBudget=settings({salaryDay:31,expectedSalary:1000,amounts:{消费:700,浪费:50,投资:250}});
 const f=fixture(initial),state=await f.repo.ensureRecurringSalary('2026-11-30');
 assert.equal(f.writes(),1);assert.equal(state.transactions.length,2);assert.equal(state.otherLedgers.family.transactions.length,2);
 assert.deepEqual(state.otherLedgers.family.transactions.map(t=>t.date).sort(),['2026-10-31','2026-11-30']);
 assert.equal(state.otherLedgers.travel.transactions.length,0);
});
test('changing salary settles overdue old settings first and only changes future income',async()=>{
 const f=fixture(seeded());
 let state=await f.repo.saveSalaryBudget(settings({expectedSalary:8000}),0,'2026-11-16');
 assert.deepEqual(state.transactions.map(t=>t.amount),[7000,7000]);
 assert.equal(state.salaryBudget.expectedSalary,8000);
 state=await f.repo.ensureRecurringSalary('2026-12-15');
 assert.equal(state.transactions.find(t=>t.date==='2026-12-15').amount,8000);
 assert.equal(state.transactions.find(t=>t.date==='2026-10-15').amount,7000);
});
test('first activation starts today and resuming does not backfill paused months',async()=>{
 const f=fixture();
 let state=await f.repo.saveSalaryBudget(settings(),0,'2026-10-16');
 assert.equal(state.transactions.length,0);assert.equal(state.salaryBudget.autoIncome.startDate,'2026-10-16');
 state=await f.repo.ensureRecurringSalary('2026-11-15');assert.equal(state.transactions.length,1);
 state=await f.repo.saveSalaryBudget({...state.salaryBudget,autoIncome:{...state.salaryBudget.autoIncome,enabled:false}},state.revision,'2026-11-16');
 state=await f.repo.saveSalaryBudget({...state.salaryBudget,autoIncome:{...state.salaryBudget.autoIncome,enabled:true}},state.revision,'2027-02-16');
 assert.equal(state.transactions.length,1);
 state=await f.repo.ensureRecurringSalary('2027-03-15');assert.deepEqual(state.transactions.map(t=>t.date).sort(),['2026-11-15','2027-03-15']);
});
test('failed storage cannot advance the cursor, while a lost response is reconciled without duplication',async()=>{
 const failed=fixture(seeded());failed.fail();await assert.rejects(failed.repo.ensureRecurringSalary('2026-10-15'),/quota/);
 assert.deepEqual(await failed.read(),seeded());
 const lost=fixture(seeded());lost.loseReply();const state=await lost.repo.ensureRecurringSalary('2026-10-15');
 assert.equal(state.transactions.length,1);assert.equal(lost.writes(),1);
});
