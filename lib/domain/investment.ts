import { cents, sumMoney } from "./finance.ts";
import type { FinancialCycle, InvestmentAccount, InvestmentFlow, MarketValueSnapshot } from "./types.ts";

export function netContribution(account: InvestmentAccount, flows: InvestmentFlow[]): number | null {
  if (account.openingNetContribution === null) return null;
  const relevant = flows.filter(flow => flow.accountId === account.id);
  const contributions = sumMoney(relevant.filter(flow => flow.type === "contribution").map(flow => flow.amount));
  const withdrawals = sumMoney(relevant.filter(flow => flow.type === "withdrawal").map(flow => flow.amount));
  return (cents(account.openingNetContribution) + cents(contributions) - cents(withdrawals)) / 100;
}

export function floatingPnL(account: InvestmentAccount, flows: InvestmentFlow[]): number | null {
  const contributed = netContribution(account, flows);
  return contributed === null ? null : (cents(account.currentMarketValue) - cents(contributed)) / 100;
}

export function investmentContributionsInCycle(cycle: FinancialCycle, flows: InvestmentFlow[]): number {
  return sumMoney(flows.filter(flow => flow.type === "contribution" && flow.cycleId === cycle.id && flow.date >= cycle.startDate && flow.date <= cycle.endDate).map(flow => flow.amount));
}

export function latestMarketValue(accountId: string, snapshots: MarketValueSnapshot[]): MarketValueSnapshot | null {
  return snapshots.filter(snapshot => snapshot.accountId === accountId).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0] ?? null;
}
