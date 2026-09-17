import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, normalizeBackup } from '../lib/data/schema.ts';
import { createRepository } from '../lib/data/repository.ts';
import { calculateFinance, salaryCycle } from '../lib/domain/finance.ts';
import { floatingPnL, netContribution } from '../lib/domain/investment.ts';

function memoryStore(seed=defaultState()) {
  let value=structuredClone(seed);
  return {read:async()=>structuredClone(value),commit:async(next,revision)=>{if(value.revision!==revision) throw Error('stale');value=structuredClone(next);}};
}
const cycle=salaryCycle('2026-09-16',15);
const plan={cycleId:cycle.id,availableIncome:20000,plannedSavings:5000,necessaryReserve:0,model:'nature'};
const account={id:'etf',name:'纳指 + 标普',openingNetContribution:70000,currentMarketValue:78724.8,marketValueUpdatedAt:'2026-09-16',createdAt:'2026-09-16'};

test('v1/v2 backups migrate to v3 with empty investment collections',()=>{
  const v2={...defaultState(),version:2,investmentAccounts:undefined,investmentFlows:undefined,marketValueSnapshots:undefined};
  const migrated=normalizeBackup(JSON.parse(JSON.stringify(v2)));
  assert.equal(migrated.version,3);
  assert.deepEqual(migrated.investmentAccounts,[]);
  assert.deepEqual(migrated.investmentFlows,[]);
  assert.deepEqual(migrated.marketValueSnapshots,[]);
});

test('manual market value updates never create income or expense transactions',async()=>{
  const repo=createRepository(memoryStore());
  let state=await repo.saveInvestmentAccount(account,0);
  state=await repo.saveMarketValue('etf',80136.5,'2026-09-20',state.revision);
  assert.equal(state.transactions.length,0);
  assert.equal(state.investmentAccounts[0].currentMarketValue,80136.5);
  assert.equal(state.marketValueSnapshots.length,2);
  assert.equal(state.marketValueSnapshots[0].marketValue,80136.5);
});

test('net contribution and floating P/L stay separate from current market value',async()=>{
  const repo=createRepository(memoryStore());
  let state=await repo.saveInvestmentAccount(account,0);
  state=await repo.saveInvestmentFlow({id:'flow-1',accountId:'etf',type:'contribution',amount:5000,date:'2026-09-16',cycleId:null},state.revision);
  assert.equal(netContribution(state.investmentAccounts[0],state.investmentFlows),75000);
  assert.equal(floatingPnL(state.investmentAccounts[0],state.investmentFlows),3724.8);
  state=await repo.saveInvestmentFlow({id:'flow-2',accountId:'etf',type:'withdrawal',amount:1000,date:'2026-09-17',cycleId:null},state.revision);
  assert.equal(netContribution(state.investmentAccounts[0],state.investmentFlows),74000);
});

test('cycle contributions count toward investment progress without becoming expenses',async()=>{
  const seed={...defaultState(),revision:0,profile:{salaryDay:15},activeCycleId:cycle.id,cycles:[cycle],budgets:[plan]};
  const repo=createRepository(memoryStore(seed));
  let state=await repo.saveInvestmentAccount(account,0);
  state=await repo.saveInvestmentFlow({id:'flow-cycle',accountId:'etf',type:'contribution',amount:5500,date:'2026-09-16',cycleId:cycle.id},state.revision);
  const metrics=calculateFinance(cycle,plan,state.transactions,state.investmentFlows);
  assert.equal(metrics.investmentSpend,5500);
  assert.equal(metrics.safeToSpend,14500);
  assert.equal(state.transactions.length,0);
});

test('withdrawals do not become salary income or reverse prior investment progress',async()=>{
  const seed={...defaultState(),profile:{salaryDay:15},activeCycleId:cycle.id,cycles:[cycle],budgets:[plan]};
  const repo=createRepository(memoryStore(seed));
  let state=await repo.saveInvestmentAccount(account,0);
  state=await repo.saveInvestmentFlow({id:'in',accountId:'etf',type:'contribution',amount:5000,date:'2026-09-16',cycleId:cycle.id},state.revision);
  state=await repo.saveInvestmentFlow({id:'out',accountId:'etf',type:'withdrawal',amount:3000,date:'2026-09-17',cycleId:cycle.id},state.revision);
  const metrics=calculateFinance(cycle,plan,state.transactions,state.investmentFlows);
  assert.equal(metrics.investmentSpend,5000);
  assert.equal(state.transactions.filter(tx=>tx.type==='income').length,0);
});

test('unknown opening contribution hides P/L instead of inventing a return',()=>{
  const unknown={...account,openingNetContribution:null};
  assert.equal(netContribution(unknown,[]),null);
  assert.equal(floatingPnL(unknown,[]),null);
});
