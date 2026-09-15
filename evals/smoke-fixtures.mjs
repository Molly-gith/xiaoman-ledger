// Synthetic plumbing examples, NOT the approved ~290-case evaluation corpus.
const context = { today: "2026-09-15", timezone: "Asia/Shanghai" };
export const smokeCases = [
  { case_id: "smoke-parse-expense", capability: "parseTransaction", user_input: "昨晚吃火锅268元", user_context: context,
    expected_structured_output: { type: "expense", amount: 268, category: "餐饮", occurred_at: "2026-09-14", note: "吃火锅", nature_suggestion: "消费", confidence: 0.95, ambiguous: false } },
  { case_id: "smoke-parse-income", capability: "parseTransaction", user_input: "今天工资8000元", user_context: context,
    expected_structured_output: { type: "income", amount: 8000, category: "收入", occurred_at: "2026-09-15", note: "工资", nature_suggestion: null, confidence: 0.99, ambiguous: false } },
  { case_id: "smoke-nature-medical", capability: "recommendNature",
    user_input: { type: "expense", amount: 120, category: "健康", occurred_at: "2026-09-15", note: "必要的门诊用药", nature_suggestion: null, confidence: 1, ambiguous: false }, user_context: context,
    acceptable_labels: ["消费", "投资"], unacceptable_labels: ["浪费"],
    expected_structured_output: { recommended_nature: "消费", acceptable_alternative: "投资", reason: "必要医疗支出，最终由用户确认", confidence: 0.95 } },
];
