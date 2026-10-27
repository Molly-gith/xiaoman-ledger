import type { AssistantRequest, AssistantWorkflowOutput } from "./assistant-contract.ts";

// Model prose is not evidence for amounts, counts or budget conclusions. Render
// those answers from the already validated program report, selecting the facts
// the question asks about. This also guards next_actions, not just the answer.
const numericClaim = /[0-9０-９%％]|[〇零一二两三四五六七八九十百千万亿]+(?:元|块|笔|倍|成|天|个月|年)|[〇零一二两三四五六七八九十百千万亿]{2,}/;
const budgetClaim = /预算|超支|可花|能花|还能花|可用资金|安全支出|safe.?to.?spend|over.?budget|available.?to.?spend/i;
const historyClaim = /上个?(?:月|周期)|上期|去年|历史|增长|下降|增加|减少|相比|比较|变化|同比|环比|last (?:month|period)|compar|increas|decreas/i;
const investmentClaim = /收益|市值|盈亏|资产|净值|回报|余额|return|profit|asset|market.?value/i;
const reportQuestion = /收入|支出|消费|浪费|投资|未分类|花|收支|结余|几笔|多少笔|笔数|统计|多少|income|expense|spen[dt]|balance|how (?:much|many)/i;
const safeActions = new Set(["查看当前日期范围的账目", "核对收入和支出记录", "核对待确认日期的记录"]);

function cautiousAdvice(answer: string): string {
  return answer.split(/(?<=[。！？\n])/).map(sentence => sentence.trim()).filter(sentence =>
    /^(?:建议|可以|不妨|请先|先)/.test(sentence) && /核对|查看|回看|检查|确认|关注|记录|整理/.test(sentence)
    && !numericClaim.test(sentence) && !budgetClaim.test(sentence) && !historyClaim.test(sentence) && !investmentClaim.test(sentence)
    && !/明显|偏多|过高|过低|超过|不足|占比|主要|最多|最少|高于|低于|新增分类|创建分类|标签|同龄|对比周期|已保存|已记/.test(sentence)
  ).slice(0, 2).join("");
}

export function guardedReportAnswer(value: AssistantWorkflowOutput, request: AssistantRequest): { status: "answer"; answer: string; nextActions: string[] } {
  const question = `${request.clarification?.originalText ?? ""}\n${request.text}`;
  const prose = [value.answer, ...value.next_actions].join("\n");
  const usageQuestion = /(?:怎么|如何|怎样).{0,12}(?:记账|保存|修改草稿|语音|选择日期)/.test(question);
  const mustRender = (!!request.report && !usageQuestion) || reportQuestion.test(question) || budgetClaim.test(question) || historyClaim.test(question) || investmentClaim.test(question)
    || numericClaim.test(prose) || budgetClaim.test(prose) || historyClaim.test(prose) || investmentClaim.test(prose);
  if (!mustRender) return { status: "answer", answer: value.answer, nextActions: value.next_actions.filter(action => safeActions.has(action)) };
  const report = request.report;
  if (!report) return { status: "answer", answer: "本次没有收到日期统计摘要，暂时无法核实账目金额。请先选择要查看的日期范围。", nextActions: [] };

  const period = `${report.range.startDate} 至 ${report.range.endDate}`;
  const prefix = `在 ${period} 的现有记录中，`;
  let answer: string;
  if (budgetClaim.test(question)) answer = `${prefix}支出为${report.expense}元。本次统计未包含预算或可用资金，不能据此判断超支或还能花多少。`;
  else if (historyClaim.test(question)) answer = `本次收到的摘要只包含 ${period} 的记录，没有对照时段的数据，暂时无法比较变化。`;
  else if (investmentClaim.test(question)) answer = `${prefix}标为投资的支出为${report.natureTotals.投资}元。本次统计未包含账户余额、投资市值或收益，不能据此判断资产或盈亏。`;
  else if (/餐饮|购物|交通|居住|健康|医疗|学习|娱乐|分类明细|最多|最少|排名|占比|比例|平均/.test(question)) answer = `${prefix}支出共${report.expense}元。本次统计未包含分类明细、排名或比例，暂时无法回答这部分。`;
  else if (/几笔|多少笔|笔数|how many/i.test(question)) answer = `${prefix}共${report.transactionCount}笔账目，其中收入${report.incomeCount}笔、支出${report.expenseCount}笔。`;
  else if (/消费|浪费|投资|未分类/.test(question)) {
    const names = (["消费", "浪费", "投资", "未分类"] as const).filter(name => question.includes(name));
    answer = `${prefix}${names.map(name => `${name}支出${report.natureTotals[name]}元`).join("，")}。这些是支出性质统计。`;
  } else if (/收入|income/i.test(question) && !/支出|收支|结余|expense|balance/i.test(question)) answer = `${prefix}收入为${report.income}元。`;
  else if (/支出|花|expense|spen[dt]/i.test(question) && !/收入|收支|结余|income|balance/i.test(question)) answer = `${prefix}支出为${report.expense}元。`;
  else answer = `${prefix}收入${report.income}元、支出${report.expense}元，账面收支结余${report.balance}元。收支结余不代表账户余额或可用预算。`;
  if (report.pendingDateCount > 0) answer += `其中${report.pendingDateCount}笔旧记录的日期待核对，日期统计可能随核对结果调整。`;
  // Preserve useful model suggestions only as cautious, non-numeric checks of
  // existing records. Never attach a speculative financial assertion to facts.
  const advice = cautiousAdvice(value.answer);
  if (advice) answer += `\n${advice}`;
  return { status: "answer", answer, nextActions: [] };
}
