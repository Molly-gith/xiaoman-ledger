export type LedgerCategory = "餐饮" | "购物" | "交通" | "居住" | "健康" | "收入" | "其他";

export const EXPENSE_CATEGORIES: LedgerCategory[] = ["餐饮", "购物", "交通", "居住", "健康", "其他"];

export const CATEGORY_ICONS: Record<LedgerCategory, string> = { 餐饮: "餐", 购物: "购", 交通: "行", 居住: "住", 健康: "医", 收入: "收", 其他: "其" };

const RULES: { category: Exclude<LedgerCategory, "收入" | "其他">; icon: string; pattern: RegExp }[] = [
  {
    category: "餐饮",
    icon: "餐",
    pattern: /早餐|午餐|晚餐|夜宵|外卖|餐馆|饭店|吃饭|米饭|咖啡|奶茶|饮料|零食|食品|食材|米面粮油|粮油|食用油|大米|买米|米粉|面粉|挂面|面条|馒头|面包|油条|蔬菜|水果|生鲜|车厘子|猪肉|牛肉|鸡肉|鱼肉|海鲜|鸡蛋|牛奶|酸奶|买菜/,
  },
  {
    category: "交通",
    icon: "行",
    pattern: /地铁|公交|打车|出租车|网约车|高铁|火车票|机票|车票|车费|停车|过路费|过桥费|加油|油费|汽油|柴油|充电桩|修车|洗车|车险|出行/,
  },
  {
    category: "居住",
    icon: "住",
    pattern: /房租|租房|房贷|物业费|水费|电费|燃气费|天然气|宽带费|维修费/,
  },
  {
    category: "健康",
    icon: "医",
    pattern: /买药|药店|药品|医院|看病|挂号|体检|牙医|诊所|治疗|保健品/,
  },
  {
    category: "购物",
    icon: "购",
    pattern: /指甲油|台灯|衣服|衣物|裤子|鞋子|鞋|箱包|包包|化妆品|护肤品|日用品|百货|家居|家具|数码|手机|电脑|耳机|淘宝|京东|拼多多|网购|购物|购买|买了|买个|买一|买/,
  },
];

export function classifyTransaction(text: string, type: "expense" | "income"): { category: LedgerCategory; icon: string } {
  if (type === "income") return { category: "收入", icon: CATEGORY_ICONS.收入 };
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  const match = RULES.find((rule) => rule.pattern.test(normalized));
  return match ? { category: match.category, icon: match.icon } : { category: "其他", icon: "其" };
}

