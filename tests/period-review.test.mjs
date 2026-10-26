import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPeriodReview, describePeriodReview, selectPeriodReviewEvidence } from '../lib/domain/period-review.ts';
import { cents } from '../lib/domain/finance.ts';

const range = (startDate, endDate) => ({ startDate, endDate });
const tx = (id, date, amount, extra = {}) => ({
  id, date, amount, type: 'expense', category: '餐饮', nature: '消费', note: 'private memo',
  icon: '记', source: 'text', cycleId: null, spendKind: 'variable', ...extra,
});
const income = (id, date, amount) => tx(id, date, amount, { type: 'income', category: '收入', nature: null, spendKind: null });
const current = range('2026-10-03', '2026-10-05');

test('closed date ranges compare the immediately preceding equal days with exact cents, counts and independent categories/natures', () => {
  const records = [
    tx('before', '2026-09-29', 777), income('old-income', '2026-09-30', 100.1),
    tx('old-meal', '2026-10-01', 20), tx('old-shop', '2026-10-02', 5, { category: '购物', nature: '浪费' }),
    income('new-income', '2026-10-03', 120.2), tx('meal-a', '2026-10-03', 0.1),
    tx('meal-b', '2026-10-04', 0.2, { cycleId: 'unrelated-budget' }),
    tx('course', '2026-10-04', 10, { category: '健康', nature: '投资' }),
    tx('shop', '2026-10-05', 4, { category: '购物', nature: '浪费' }),
    tx('unknown', '2026-10-05', 2, { category: '其他', nature: null, spendKind: null }),
    tx('after', '2026-10-06', 888),
  ];
  const before = structuredClone(records), result = buildPeriodReview(records, current);
  assert.deepEqual(result.previous.range, range('2026-09-30', '2026-10-02'));
  assert.equal(result.current.dayCount, 3); assert.equal(result.previous.dayCount, 3);
  assert.deepEqual(result.current.totals, { transactionCount: 6, incomeCount: 1, expenseCount: 5, incomeFen: 12020, expenseFen: 1630, balanceFen: 10390 });
  assert.deepEqual(result.previous.totals, { transactionCount: 3, incomeCount: 1, expenseCount: 2, incomeFen: 10010, expenseFen: 2500, balanceFen: 7510 });
  assert.deepEqual(result.comparison.delta, { transactionCount: 3, incomeCount: 0, expenseCount: 3, incomeFen: 2010, expenseFen: -870, balanceFen: 2880 });
  assert.equal(result.comparison.status, 'available');
  assert.deepEqual(result.current.expenseNatures.map(row => [row.label, row.amountFen, row.count]), [['消费', 30, 2], ['浪费', 400, 1], ['投资', 1000, 1], ['未分类', 200, 1]]);
  assert.deepEqual(records, before, 'review never changes dates, cycle ownership, amounts or records');
  const text = describePeriodReview(result, '个人账本');
  assert.match(text, /支出16.30元/); assert.match(text, /支出减少8.70元/);
  assert.match(text, /不是账户余额或可用预算/); assert.match(text, /不代表投资收益或账户市值/);
  assert.doesNotMatch(text, /超支|投资赚|回报率/); assert.ok(text.length <= 1600);
});

test('every total and breakdown is traceable to the exact same local evidence including disappeared categories', () => {
  const records = [income('i', '2026-10-03', 20), tx('a', '2026-10-03', 2.15),
    tx('b', '2026-10-05', 1.85, { nature: '浪费' }),
    tx('old', '2026-10-01', 9, { category: '交通', nature: '投资' })];
  const report = buildPeriodReview(records, current);
  for (const period of [report.current, report.previous]) {
    for (const kind of ['income', 'expense']) {
      const selected = selectPeriodReviewEvidence(records, period.evidence[kind]);
      assert.equal(selected.reduce((sum, row) => sum + cents(row.amount), 0), period.totals[kind + 'Fen']);
      assert.equal(selected.length, period.totals[kind + 'Count']);
    }
    assert.equal(selectPeriodReviewEvidence(records, period.evidence.all).length, period.totals.transactionCount);
    for (const row of [...period.expenseCategories, ...period.expenseNatures]) {
      const selected = selectPeriodReviewEvidence(records, row.evidence);
      assert.equal(selected.reduce((sum, item) => sum + cents(item.amount), 0), row.amountFen);
      assert.equal(selected.length, row.count);
    }
  }
  const old = report.comparison.expenseCategories.find(row => row.label === '交通');
  assert.deepEqual([old.currentFen, old.previousFen, old.deltaFen, old.currentCount, old.previousCount, old.deltaCount], [0, 900, -900, 0, 1, -1]);
  assert.deepEqual(selectPeriodReviewEvidence(records, old.evidence.current), []);
  assert.deepEqual(selectPeriodReviewEvidence(records, old.evidence.previous).map(row => row.id), ['old']);
  assert.doesNotMatch(JSON.stringify(report), /private memo|unrelated-budget|"id":/);
});

test('no records is distinct from recorded zero balance or income-only zero recorded expenses', () => {
  const empty = buildPeriodReview([], current);
  assert.equal(empty.current.status, 'no_records'); assert.equal(empty.previous.status, 'no_records');
  assert.equal(empty.comparison.reason, 'no_current_records'); assert.equal(empty.comparison.delta, null);
  const noHistory = buildPeriodReview([tx('now', '2026-10-03', 35)], current);
  assert.equal(noHistory.current.status, 'recorded'); assert.equal(noHistory.previous.status, 'no_records');
  assert.equal(noHistory.comparison.reason, 'no_previous_records'); assert.equal(noHistory.comparison.delta, null);
  const text = describePeriodReview(noHistory, '家庭账本');
  assert.match(text, /前一时段没有已记录/); assert.doesNotMatch(text, /增加|减少|100%|上期.*0\.00/);
  const zeroBalance = buildPeriodReview([income('i', '2026-10-03', 8), tx('e', '2026-10-05', 8), income('prior', '2026-10-01', 3)], current);
  assert.equal(zeroBalance.current.status, 'recorded'); assert.equal(zeroBalance.current.totals.balanceFen, 0);
  assert.equal(zeroBalance.previous.status, 'recorded'); assert.equal(zeroBalance.previous.totals.expenseFen, 0);
  assert.equal(zeroBalance.comparison.status, 'available'); assert.equal(zeroBalance.comparison.delta.expenseFen, 800);
});

test('leap days, new year, single-day and long filters use equal inclusive days rather than the previous calendar month', () => {
  for (const [selected, expected, days] of [
    [range('2024-03-01', '2024-03-03'), range('2024-02-27', '2024-02-29'), 3],
    [range('2026-01-01', '2026-01-01'), range('2025-12-31', '2025-12-31'), 1],
    [range('2026-03-01', '2026-03-31'), range('2026-01-29', '2026-02-28'), 31],
    [range('2026-10-25', '2026-10-31'), range('2026-10-18', '2026-10-24'), 7],
  ]) {
    const result = buildPeriodReview([], selected);
    assert.deepEqual(result.previous.range, expected); assert.equal(result.current.dayCount, days); assert.equal(result.previous.dayCount, days);
  }
  const long = buildPeriodReview([], range('2000-01-01', '2026-12-31'));
  assert.ok(long.current.dayCount > 3660); assert.equal(long.previous.dayCount, long.current.dayCount);
});

test('unsupported previous dates disable only comparison; invalid selected dates are rejected', () => {
  const lower = buildPeriodReview([tx('oldest', '1900-01-01', 1)], range('1900-01-01', '1900-01-03'));
  assert.equal(lower.current.totals.expenseFen, 100); assert.equal(lower.previous, null);
  assert.equal(lower.comparison.reason, 'out_of_range'); assert.equal(lower.comparison.delta, null);
  assert.match(describePeriodReview(lower, '旅行账本'), /前一等长时段超出支持的日期范围/);
  assert.deepEqual(buildPeriodReview([], range('9998-12-31', '9998-12-31')).previous.range, range('9998-12-30', '9998-12-30'));
  assert.equal(buildPeriodReview([], range('1900-01-01', '9998-12-31')).previous, null);
  for (const selected of [range('1899-12-31', '1900-01-01'), range('9999-01-01', '9999-01-01'),
    range('2026-02-29', '2026-03-01'), range('2026-10-04', '2026-10-03'), { ...current, ownerId: 'other' }]) assert.throws(() => buildPeriodReview([], selected));
});

test('legacy timestamp dates are provisional, prevent trend conclusions and never change the source', () => {
  const prior = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Hong_Kong';
    const records = [tx('legacy', '2026-10-02T16:30:00Z', 5), tx('old', '2026-10-01', 10)];
    const original = structuredClone(records), result = buildPeriodReview(records, current);
    assert.equal(result.current.pendingDateCount, 1); assert.equal(result.current.totals.expenseFen, 500);
    assert.equal(result.comparison.reason, 'unconfirmed_dates'); assert.equal(result.comparison.delta, null);
    assert.match(describePeriodReview(result, '个人账本'), /核对前不比较变化/); assert.deepEqual(records, original);
    const previous = buildPeriodReview([tx('new', '2026-10-03', 5), tx('old', '2026-10-01', 10, { dateNeedsConfirmation: true })], current);
    assert.equal(previous.previous.pendingDateCount, 1); assert.equal(previous.comparison.reason, 'unconfirmed_dates');
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});

test('only the explicitly supplied active ledger is reviewed; no budget, asset balance or model facts are needed', () => {
  const personal = [tx('same-id', '2026-10-03', 12)], family = [tx('same-id', '2026-10-03', 999)];
  const first = buildPeriodReview(personal, current), second = buildPeriodReview(family, current);
  assert.equal(first.current.totals.expenseFen, 1200); assert.equal(second.current.totals.expenseFen, 99900);
  first.current.range.startDate = '2020-01-01';
  assert.deepEqual(current, range('2026-10-03', '2026-10-05')); assert.equal(second.current.range.startDate, '2026-10-03');
  for (const bad of [{ ...second.current.evidence.all, ledgerKind: 'family' }, { ...second.current.evidence.all, ownerId: 'other' },
    { ...second.current.evidence.all, sql: 'SELECT *' }, { range: current, type: 'income', nature: '投资' }]) assert.throws(() => selectPeriodReviewEvidence(personal, bad));
});

test('invalid money, duplicate records and integer sum or balance-change overflow fail honestly', () => {
  for (const amount of [0, -1, 0.001, NaN, Infinity, 1e12]) assert.throws(() => buildPeriodReview([tx('bad', '2026-10-03', amount)], current));
  assert.throws(() => buildPeriodReview([tx('same', '2026-10-03', 1), tx('same', '2026-10-04', 2)], current));
  const max = 999999999999.99;
  assert.throws(() => buildPeriodReview(Array.from({ length: 91 }, (_, i) => tx('many-' + i, '2026-10-03', max)), current), /超过/);
  const oppositeBalances = [
    ...Array.from({ length: 90 }, (_, i) => income('new-' + i, '2026-10-03', max)),
    ...Array.from({ length: 90 }, (_, i) => tx('old-' + i, '2026-10-01', max)),
  ];
  assert.throws(() => buildPeriodReview(oppositeBalances, current), /差额超过/);
});

test('large valid aggregates retain original integer cents and narrative cent precision', () => {
  const records = Array.from({ length: 90 }, (_, i) => tx('n-' + i, '2026-10-03', 999999999999.99));
  records.push(tx('prior', '2026-10-01', 0.01));
  const review = buildPeriodReview(records, current);
  assert.equal(review.current.totals.expenseFen, 8999999999999910);
  assert.equal(review.comparison.delta.expenseFen, 8999999999999909);
  const text = describePeriodReview(review, '个人账本');
  assert.match(text, /支出89999999999999\.10元/); assert.match(text, /支出增加89999999999999\.09元/);
});

test('an unfinished selected interval labels differences as recorded activity, never a full-period trend', () => {
  const report = buildPeriodReview([tx('now', '2026-10-03', 35), tx('old', '2026-10-01', 50)], current, '2026-10-04');
  assert.equal(report.currentIncomplete, true); assert.equal(report.comparison.status, 'available');
  assert.match(describePeriodReview(report, '个人账本'), /所选时段尚未结束.*不能把差额当作完整周期的变化/);
  assert.match(describePeriodReview(report, '个人账本'), /与前一时段已记录的收支相比/);
  assert.equal(buildPeriodReview([], current, '2026-10-05').currentIncomplete, false);
  assert.throws(() => buildPeriodReview([], current, 'invalid'));
});
