import type { TransactionDraft } from "../ai/adapter.ts";
import type { ExpenseNature } from "./types.ts";

export const EXPENSE_CATEGORIES = ["餐饮", "购物", "交通", "居住", "健康", "医疗", "学习", "娱乐", "其他"] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type PreferenceRule = { id: string; keyword: string; category: ExpenseCategory | null; nature: ExpenseNature | null };
export type PreferenceProposal = Omit<PreferenceRule, "id"> & { requiresConfirmation: true };
export const MAX_PREFERENCES = 50;
const natures = ["消费", "浪费", "投资"];
const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
export const preferenceKeyword = (value: string) => normalize(value);
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function validatePreferenceRule(value: unknown): value is PreferenceRule {
  if (!plain(value) || Object.keys(value).length !== 4 || Object.keys(value).some(key => !["id", "keyword", "category", "nature"].includes(key))) return false;
  return typeof value.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value.id)
    && typeof value.keyword === "string" && value.keyword === value.keyword.trim() && value.keyword.length >= 2 && value.keyword.length <= 40
    && !Array.from(value.keyword).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && (value.category === null || EXPENSE_CATEGORIES.includes(value.category as ExpenseCategory))
    && (value.nature === null || (typeof value.nature === "string" && natures.includes(value.nature))) && (value.category !== null || value.nature !== null);
}

/** A small local parser proposes a rule for confirmation; it never saves it. */
export function parsePreferenceProposal(input: string): PreferenceProposal | null {
  if (typeof input !== "string" || input.length > 200 || /[?？]|不要|别|不再|不记|不是|不算|取消|删除|移除|忘记/.test(input)) return null;
  const match = input.trim().match(/^(?:请)?(?:记住[：:，,]?\s*(?:(?:从今以后|以后|今后)[：:，,]?)?|(?:从今以后|以后|今后)[：:，,]?)\s*(?:将|把)?\s*(.+?)\s*(?:都|一律)?\s*(?:记为|记成|算作|算|归为|当作|视为|=|＝)\s*(投资|消费|浪费)(?:类)?[。！!]?$/);
  if (!match) return null;
  const keyword = match[1].trim().replace(/[“”「」『』]/g, "");
  if (/\d|今天|昨天|明天|这次|本次|这笔|刚刚|所有|全部|任何|每笔|[，,；;。]/.test(keyword)) return null;
  const proposed: PreferenceRule = { id: "proposal", keyword, category: null, nature: match[2] as ExpenseNature };
  if (!validatePreferenceRule(proposed)) return null;
  const { id: _id, ...rule } = proposed;
  void _id;
  return { ...rule, requiresConfirmation: true };
}

function literalMatch(text: string, keyword: string): boolean {
  let index = text.indexOf(keyword);
  while (index !== -1) {
    const before = text[index - 1] ?? "", after = text[index + keyword.length] ?? "";
    if (!(/^[a-z0-9]/i.test(keyword) && /[a-z0-9]/i.test(before))
      && !(/[a-z0-9]$/i.test(keyword) && /[a-z0-9]/i.test(after))) return true;
    index = text.indexOf(keyword, index + 1);
  }
  return false;
}

function hasOverride(text: string, nature: ExpenseNature | null): boolean {
  const normalized = normalize(text);
  // Negations often follow a comma ("健身课200，这次不算投资"). Conservatively
  // leave the draft alone even if a multi-item sentence makes their target unclear.
  return /不是|不算|不应|不该|不属于|不要|别按|别记|不能|不再|取消|删除|移除|忘记/.test(normalized)
    || (nature !== null && natures.some(other => other !== nature && new RegExp(`(?:记为|记成|算作|归为|当作|视为|算)\\s*${other}`).test(normalized)));
}

/** Applies only saved expense preferences. The original note is the matching scope;
 * full input is used only to veto a negation/one-time override, never to match other drafts.
 * Nothing here changes money, date, transaction type, or writes to a ledger.
 */
export function applyPreferenceToDraft<T extends TransactionDraft>(draft: T, preferences: readonly PreferenceRule[], sourceText = ""): { draft: T; preferenceId: string | null; reason: string | null } {
  const unchanged = () => ({ draft: { ...draft }, preferenceId: null, reason: null });
  if (draft.type !== "expense" || typeof draft.note !== "string" || !Array.isArray(preferences) || preferences.length > MAX_PREFERENCES) return unchanged();
  if (!preferences.every(validatePreferenceRule)) return unchanged();
  const matches = preferences.filter(rule => literalMatch(normalize(draft.note), normalize(rule.keyword))).sort((a, b) => b.keyword.length - a.keyword.length);
  if (!matches.length) return unchanged();
  const rule = matches[0], keyword = normalize(rule.keyword);
  if (hasOverride(draft.note, rule.nature) || hasOverride(sourceText, rule.nature)) return unchanged();
  // A longer specific keyword wins over a contained generic one. Distinct purposes
  // with conflicting rules are ambiguous, so the user keeps the original draft.
  if (matches.some(other => !keyword.includes(normalize(other.keyword)) && (other.category !== rule.category || other.nature !== rule.nature))) return unchanged();
  const changes = [rule.category ? `分类为${rule.category}` : "", rule.nature ? `性质为${rule.nature}` : ""].filter(Boolean);
  return { draft: { ...draft, ...(rule.category ? { category: rule.category } : {}), ...(rule.nature ? { nature_suggestion: rule.nature } : {}) },
    preferenceId: rule.id, reason: `按照你在本账本保存的“${rule.keyword}”偏好，建议${changes.join("、")}。` };
}
