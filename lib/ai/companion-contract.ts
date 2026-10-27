import { describeCompanionFact, type CompanionContext, type CompanionFactId } from "../domain/companion-context.ts";

/** Free prose stays qualitative. Complete numeric clauses are rendered from
 * fixed, referenced facts; copying a coincidentally matching number is not proof. */
export function renderCompanionAnswer(answer: string, referencedFacts: readonly string[], context: CompanionContext): string | null {
  if (!answer.trim() || answer.length > 650 || referencedFacts.length > 3 || new Set(referencedFacts).size !== referencedFacts.length) return null;
  const available = new Set(context.facts.map(f => f.id));
  if (referencedFacts.some(id => !available.has(id as CompanionFactId))) return null;
  const used = [...answer.matchAll(/\[\[fact:([a-z_]+)\]\]/g)].map(match => match[1]);
  if (new Set(used).size !== used.length || used.length !== referencedFacts.length || used.some(id => !referencedFacts.includes(id))) return null;
  const prose = answer.replace(/\[\[fact:[a-z_]+\]\]/g, "").normalize("NFKC");
  // No hidden slots, executable content, figures, currencies, percentages or
  // meal-equivalence claims. Idioms such as 一下、一点、一笔 remain natural.
  if ([...prose].some(char => char.charCodeAt(0) < 32 && !["\n", "\r", "\t"].includes(char))) return null;
  if (/\[\[|\]\]|[<>]|https?:|\d|[%％¥￥$]|(?:[零〇一二两三四五六七八九十百千万亿半]+)(?:元|块|角|分(?:钱)?|顿|倍|成|%|％)|(?:翻倍|翻番|减半|一半)|(?:等于|相当于|抵得上|够买).{0,12}(?:午餐|午饭|饭钱|餐费)/i.test(prose)) return null;
  if (/(?:已(?:经)?|帮你|替你|为你|我(?:会|将|已经)?).{0,8}(?:保存|记录|记账|记好|记下|记入|录入|录进|删掉|删除|修改|转账|转了|买入|卖出)|记好了|存好了|已到账|到账了|已记账|已经记住|我会记住|永久记住|自动(?:扣款|转账|买入)|买(?:这只|入).{0,5}(?:股票|基金)|保证收益|稳赚|包赚/i.test(prose)) return null;
  // A joke may target a choice, never the person; no invented nutrition/health effects.
  if (/穷鬼|败家(?:子|娘们)?|废物|蠢|傻[子逼]|没脑|活该|不配|你.{0,4}(?:真穷|自制力差|没救|胖)|致癌|糖尿病|血糖|排毒|治愈|治疗|燃脂|减肥|变胖|伤肝|伤胃|伤身|更健康|延年益寿|loser|idiot/i.test(prose)) return null;
  if (/省掉正餐|(?:别吃|不吃|少吃)(?:午|晚|早)饭|饿(?:着|肚子)|省(?:午餐|午饭|饭钱)|跳过正餐/.test(prose)) return null;
  // Assertions about the financial state belong in a referenced factual clause,
  // not in arbitrary prose—even if the model cited another valid fact nearby.
  if (/超支|超预算|超额|预算.{0,6}(?:不够|吃紧|见底|耗尽|用完|剩下)|(?:余额|收益|盈利|亏损|可用资金).{0,6}(?:是|有|为|达|增长|增加|减少)|(?:支出|消费|收入).{0,8}(?:翻|增长|上涨|下降|减少|增加|高于|低于|超过|少于)|(?:比|较).{0,6}(?:上期|上月|昨天).{0,6}(?:多|少|省)|(?:这|那|该).{0,5}(?:杯|笔|次).{0,6}(?:就是|属于|算是|是)浪费/.test(prose)) return null;
  const rendered = answer.replace(/\[\[fact:([a-z_]+)\]\]/g, (_token, id: CompanionFactId) => describeCompanionFact(context, id) ?? "");
  return rendered.length <= 1200 ? rendered.trim() : null;
}

export function safeCompanionFallback(context: CompanionContext): string {
  return context.tone === "plain"
    ? "这次建议没有通过事实检查。可以继续说说你的想法；涉及金额时，我只依据当前账本的已记录信息。"
    : "我听着。想买、想省，或者今天只是有点累，都可以接着说；金额我会让账本来讲，选择还是你的。";
}
