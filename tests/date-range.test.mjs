import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarMonthRange, createDateRange, summarizeDateRange, transactionsInDateRange } from '../lib/domain/date-range.ts';

const tx = (id, date, extra = {}) => ({
  id, date, type: 'expense', amount: 1, category: '餐饮', note: 'private note', icon: '餐',
  source: 'text', cycleId: null, nature: '消费', spendKind: 'variable', ...extra,
});

test('historical calendar months include leap February, December and year boundaries', () => {
  assert.deepEqual(calendarMonthRange('2024-02'), { startDate: '2024-02-01', endDate: '2024-02-29' });
  assert.deepEqual(calendarMonthRange('2025-02'), { startDate: '2025-02-01', endDate: '2025-02-28' });
  assert.deepEqual(calendarMonthRange('2025-12'), { startDate: '2025-12-01', endDate: '2025-12-31' });
  assert.deepEqual(calendarMonthRange('2026-01'), { startDate: '2026-01-01', endDate: '2026-01-31' });
});

test('invalid months and impossible or reversed ranges are rejected', () => {
  for (const month of ['2026-2', '2026-00', '2026-13', '2026-02-01', '1899-01', '9999-01']) {
    assert.throws(() => calendarMonthRange(month));
  }
  assert.throws(() => createDateRange('2025-02-29', '2025-03-01'));
  assert.throws(() => createDateRange('2026-10-02', '2026-10-01'));
  assert.throws(() => createDateRange('2026-10-01T00:00:00Z', '2026-10-02'));
  assert.throws(() => transactionsInDateRange([], { startDate: 'invalid', endDate: '2026-10-02' }));
});

test('arbitrary closed ranges include both endpoints across months and years, regardless of cycle', () => {
  const records = [tx('before', '2025-12-30'), tx('start', '2025-12-31'),
    tx('middle', '2026-01-01', { cycleId: 'historical-period' }), tx('end', '2026-02-01'), tx('after', '2026-02-02')];
  const before = structuredClone(records);
  assert.deepEqual(transactionsInDateRange(records, createDateRange('2025-12-31', '2026-02-01')).map(t => t.id), ['start', 'middle', 'end']);
  assert.deepEqual(transactionsInDateRange(records, createDateRange('2026-01-01', '2026-01-01')).map(t => t.id), ['middle']);
  assert.deepEqual(records, before);
});

test('summary counts all unassigned and historical transactions with exact fen arithmetic', () => {
  const range = calendarMonthRange('2026-10');
  const records = [
    tx('income-a', '2026-10-01', { type: 'income', amount: 0.1, nature: null, spendKind: null }),
    tx('income-b', '2026-10-31', { type: 'income', amount: 0.2, nature: null, spendKind: null, cycleId: 'old-cycle' }),
    tx('consume', '2026-10-02', { amount: 0.1 }),
    tx('waste', '2026-10-03', { amount: 0.2, nature: '浪费' }),
    tx('invest', '2026-10-04', { amount: 0.3, nature: '投资', cycleId: 'old-cycle' }),
    tx('unknown', '2026-10-05', { amount: 0.4, nature: null, spendKind: null }),
    tx('outside', '2026-11-01', { amount: 900 }),
  ];
  assert.deepEqual(summarizeDateRange(records, range), {
    range, transactionCount: 6, incomeCount: 2, expenseCount: 4,
    income: 0.3, expense: 1, balance: -0.7,
    natureTotals: { 消费: 0.1, 浪费: 0.2, 投资: 0.3, 未分类: 0.4 }, pendingDateCount: 0,
  });
});

test('empty and income-only ranges report zero expenses rather than inventing spending', () => {
  const range = calendarMonthRange('2026-10');
  assert.deepEqual(summarizeDateRange([tx('outside', '2026-09-30')], range), {
    range, transactionCount: 0, incomeCount: 0, expenseCount: 0,
    income: 0, expense: 0, balance: 0,
    natureTotals: { 消费: 0, 浪费: 0, 投资: 0, 未分类: 0 }, pendingDateCount: 0,
  });
  const result = summarizeDateRange([tx('income', '2026-10-10', { type: 'income', amount: 100, nature: null, spendKind: null })], range);
  assert.equal(result.income, 100); assert.equal(result.balance, 100);
  assert.equal(result.expenseCount, 0); assert.equal(result.natureTotals.未分类, 0);
});

test('legacy timestamp membership uses the device day but flags uncertainty and never mutates records', () => {
  const prior = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Hong_Kong';
    const records = [tx('legacy', '2026-09-30T16:30:00Z', { dateNeedsConfirmation: true, cycleId: 'old-cycle' }),
      tx('legacy-no-cycle', '2026-09-30T16:40:00Z')];
    const before = structuredClone(records), report = summarizeDateRange(records, calendarMonthRange('2026-10'));
    assert.equal(report.transactionCount, 2); assert.equal(report.pendingDateCount, 2);
    assert.deepEqual(records, before);
    assert.equal(summarizeDateRange(records, calendarMonthRange('2026-09')).transactionCount, 0);
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});

test('cloud summary contains only deterministic totals, counts and range, with no identifying fields', () => {
  const report = summarizeDateRange([tx('private-id', '2026-10-10', { note: 'secret memo', category: 'private category', cycleId: 'private cycle' })], calendarMonthRange('2026-10'));
  assert.deepEqual(Object.keys(report).sort(), ['range', 'transactionCount', 'incomeCount', 'expenseCount', 'income', 'expense', 'balance', 'natureTotals', 'pendingDateCount'].sort());
  for (const value of ['secret memo', 'private category', 'private cycle', 'private-id']) assert.ok(!JSON.stringify(report).includes(value));
});

test('summary rejects invalid money and aggregate precision overflow instead of rounding silently', () => {
  const range = calendarMonthRange('2026-10');
  for (const amount of [0.001, -1, NaN, Infinity]) assert.throws(() => summarizeDateRange([tx('bad', '2026-10-10', { amount })], range));
  assert.throws(() => summarizeDateRange(Array.from({ length: 91 }, (_, i) => tx(String(i), '2026-10-10', { amount: 999999999999.99 })), range), /合计超过/);
});
