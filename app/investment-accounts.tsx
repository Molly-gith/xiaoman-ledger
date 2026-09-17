"use client";

import { useState, type FormEvent } from "react";
import type { InvestmentAccount, InvestmentFlow, LedgerState } from "../lib/domain/types";
import { cents } from "../lib/domain/finance";
import { floatingPnL, netContribution } from "../lib/domain/investment";
import { money } from "./ledger-components";

type Props = {
  state: LedgerState;
  today: string;
  onBack: () => void;
  onCreateAccount: (account: InvestmentAccount) => Promise<boolean>;
  onFlow: (flow: InvestmentFlow) => Promise<boolean>;
  onMarketValue: (accountId: string, value: number, date: string) => Promise<boolean>;
};

type Action = { accountId: string; mode: "flow" | "value" } | null;

function numberValue(value: string, label: string): number {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed)) throw new Error(`请输入${label}`);
  cents(parsed);
  return parsed;
}

export function InvestmentAccounts({ state, today, onBack, onCreateAccount, onFlow, onMarketValue }: Props) {
  const [adding, setAdding] = useState(state.investmentAccounts.length === 0);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [marketValue, setMarketValue] = useState("");
  const [opening, setOpening] = useState("");
  const [flowType, setFlowType] = useState<"contribution" | "withdrawal">("contribution");
  const [flowAmount, setFlowAmount] = useState("");
  const [newMarketValue, setNewMarketValue] = useState("");
  const cycle = state.cycles.find(item => item.id === state.activeCycleId);
  const cycleId = cycle && today >= cycle.startDate && today <= cycle.endDate ? cycle.id : null;

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    try {
      const current = numberValue(marketValue, "当前市值");
      const openingValue = opening.trim() ? numberValue(opening, "累计净投入") : null;
      if (!name.trim()) throw new Error("请输入投资账户名称");
      setError("");
      const saved = await onCreateAccount({
        id: crypto.randomUUID(),
        name: name.trim(),
        openingNetContribution: openingValue,
        currentMarketValue: current,
        marketValueUpdatedAt: today,
        createdAt: today,
      });
      if (saved) { setName(""); setMarketValue(""); setOpening(""); setAdding(false); }
    } catch (e) { setError(e instanceof Error ? e.message : "账户保存失败"); }
  }

  async function submitFlow(event: FormEvent, accountId: string) {
    event.preventDefault();
    try {
      const amount = numberValue(flowAmount, "金额");
      if (amount <= 0) throw new Error("金额需大于 0");
      setError("");
      const saved = await onFlow({ id: crypto.randomUUID(), accountId, type: flowType, amount, date: today, cycleId });
      if (saved) { setFlowAmount(""); setAction(null); }
    } catch (e) { setError(e instanceof Error ? e.message : "资金变化保存失败"); }
  }

  async function submitValue(event: FormEvent, accountId: string) {
    event.preventDefault();
    try {
      const value = numberValue(newMarketValue, "当前市值");
      setError("");
      const saved = await onMarketValue(accountId, value, today);
      if (saved) { setNewMarketValue(""); setAction(null); }
    } catch (e) { setError(e instanceof Error ? e.message : "市值更新失败"); }
  }

  return <>
    <header className="page-header"><button onClick={onBack}>← 返回</button><div><h1>投资账户</h1><p>看清已有资产，不把市场涨跌混进收入</p></div></header>
    <section className="gentle-tip" aria-label="投资账户说明">
      <p><b>投资账户是你已经拥有的资产。</b> 本周期准备投入多少钱，仍由首页的“投资目标”管理。</p>
      <p>ETF / 基金涨跌只更新资产市值，不会算成收入。</p>
    </section>

    {state.investmentAccounts.map(account => {
      const contribution = netContribution(account, state.investmentFlows);
      const pnl = floatingPnL(account, state.investmentFlows);
      return <section className="section-block category-card" key={account.id} data-testid="investment-account">
        <div className="section-title"><h2>{account.name}</h2><span>更新于 {account.marketValueUpdatedAt}</span></div>
        <div className="budget-row"><span>当前市值</span><b data-testid="market-value">{money(account.currentMarketValue)}</b></div>
        {contribution === null ? <p className="helper">没有填写历史累计净投入，因此暂不计算浮动盈亏。</p> : <>
          <div className="budget-row"><span>累计净投入</span><b>{money(contribution)}</b></div>
          <div className="budget-row"><span>浮动盈亏</span><b>{pnl === null ? "—" : `${pnl >= 0 ? "+" : "-"}${money(Math.abs(pnl))}`}</b></div>
        </>}
        <div className="recent-filters" aria-label={`${account.name}操作`}>
          <button onClick={() => { setAction({ accountId: account.id, mode: "flow" }); setFlowType("contribution"); setError(""); }}>投入 / 取出</button>
          <button onClick={() => { setAction({ accountId: account.id, mode: "value" }); setNewMarketValue(String(account.currentMarketValue)); setError(""); }}>更新市值</button>
        </div>
        {action?.accountId === account.id && action.mode === "flow" && <form className="category-card" onSubmit={event => void submitFlow(event, account.id)}>
          <h3>记录资金变化</h3>
          <div className="recent-filters" aria-label="资金变化类型">
            <button type="button" className={flowType === "contribution" ? "active" : ""} aria-pressed={flowType === "contribution"} onClick={() => setFlowType("contribution")}>投入</button>
            <button type="button" className={flowType === "withdrawal" ? "active" : ""} aria-pressed={flowType === "withdrawal"} onClick={() => setFlowType("withdrawal")}>取出</button>
          </div>
          <label>金额<input name="investmentFlowAmount" inputMode="decimal" value={flowAmount} onChange={event => setFlowAmount(event.target.value)} placeholder="例如 5000" /></label>
          <p className="helper">{flowType === "contribution" ? "实际投入会计入本周期投资完成额，但不是一笔新的收入。" : "取出资金不会被算成工资收入，也不会倒扣已经完成的投资目标。"}</p>
          <button className="primary" type="submit">保存资金变化</button>
        </form>}
        {action?.accountId === account.id && action.mode === "value" && <form className="category-card" onSubmit={event => void submitValue(event, account.id)}>
          <h3>更新当前市值</h3>
          <label>当前市值<input name="marketValueUpdate" inputMode="decimal" value={newMarketValue} onChange={event => setNewMarketValue(event.target.value)} /></label>
          <p className="helper">这里只更新资产价值，不会计入本周期收入或支出。</p>
          <button className="primary" type="submit">保存当前市值</button>
        </form>}
      </section>;
    })}

    {adding ? <form className="section-block category-card" onSubmit={event => void submitAccount(event)}>
      <div className="section-title"><h2>新建投资账户</h2>{state.investmentAccounts.length > 0 && <button type="button" onClick={() => setAdding(false)}>取消</button>}</div>
      <label>账户名称<input name="investmentAccountName" value={name} onChange={event => setName(event.target.value)} placeholder="例如 纳指 + 标普" /></label>
      <label>当前市值<input name="investmentMarketValue" inputMode="decimal" value={marketValue} onChange={event => setMarketValue(event.target.value)} placeholder="例如 78724.80" /></label>
      <label>历史累计净投入（可选）<input name="investmentOpeningContribution" inputMode="decimal" value={opening} onChange={event => setOpening(event.target.value)} placeholder="不知道可以先不填" /></label>
      <p className="helper">只需要抄投资 App 里的当前总市值。有需要时更新即可，不要求每天维护。</p>
      <button className="primary" type="submit">保存投资账户</button>
    </form> : <button className="primary" onClick={() => { setAdding(true); setError(""); }}>新建投资账户</button>}
    {error && <div className="error-message" role="alert">{error}</div>}
  </>;
}
