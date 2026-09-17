import { test, expect, type Page } from '@playwright/test';

const fixedNow = new Date('2026-09-15T04:00:00Z');

async function open(page: Page) {
  await page.clock.install({ time: fixedNow });
  await page.goto('./');
}

async function setup(page: Page) {
  await page.locator('[name="salaryDay"]').fill('20');
  await page.locator('[name="availableIncome"]').fill('10000');
  await page.getByRole('button', { name: '开始这个周期', exact: true }).click();
}

test('conversation-first home leads with trusted financial facts and direct chat entry', async ({ page }) => {
  await open(page);
  await setup(page);

  await expect(page.getByRole('heading', { name: '小满', exact: true })).toBeVisible();
  await expect(page.getByText('你的个人财务助手', { exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-conversation')).toBeVisible();
  await expect(page.getByTestId('assistant-readiness')).toContainText('财务数据已就绪');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
  await expect(page.getByPlaceholder('问小满：我这个月还能花多少？')).toBeVisible();
  await expect(page.getByText('AI 分析暂未启用 · 金额和比例仍由规则层计算', { exact: true })).toBeVisible();
  await expect(page.getByText('这周花多了吗？', { exact: true })).toBeVisible();

  await expect(page.getByTestId('home-action-add')).toBeVisible();
  await expect(page.getByTestId('home-action-bills')).toBeVisible();
  await expect(page.getByTestId('home-action-assets')).toBeVisible();
  await expect(page.getByTestId('home-action-review')).toBeVisible();

  await expect(page.getByRole('button', { name: '小满', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '财务', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '复盘', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '我的', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加账目', exact: true })).toBeVisible();

  await page.screenshot({ path: 'docs/screenshots/v03-conversation-home.png', fullPage: true });

  await page.getByTestId('home-action-bills').click();
  await expect(page.getByRole('heading', { name: '财务', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '消费 / 浪费 / 投资', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '投资资产', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/v03-finance.png', fullPage: true });

  await page.getByRole('button', { name: '小满', exact: true }).click();
  await page.getByTestId('home-action-assets').click();
  await expect(page.getByText('投资账户', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/v03-assets.png', fullPage: true });

  await page.getByRole('button', { name: '小满', exact: true }).click();
  await page.getByTestId('home-action-review').click();
  await expect(page.getByRole('heading', { name: '周期复盘', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/v03-review.png', fullPage: true });

  await page.getByRole('button', { name: '小满', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(page.getByTestId('assistant-conversation')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'docs/screenshots/v03-home-320.png', fullPage: true });
});

test('conversation-first home downgrades certainty when legacy data still needs review', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('xiaoman-ledger-local-v1', JSON.stringify({
    app: 'xiaoman-ledger',
    version: 1,
    ledgerKind: 'personal',
    settings: { monthlyBudget: 15000, savingsCurrent: 0, savingsGoal: 100000 },
    transactions: [{ id: 'old', type: 'expense', amount: 50, date: '2026-09-15', category: '购物', note: '旧账', icon: '购', source: 'text' }],
  })));

  await open(page);
  await page.locator('[name="salaryDay"]').fill('20');
  await page.locator('[name="availableIncome"]').fill('1000');
  await page.locator('[name="plannedSavings"]').fill('0');
  await page.getByRole('button', { name: '开始这个周期', exact: true }).click();

  await expect(page.getByTestId('assistant-readiness')).toContainText('有数据待核对');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('待核对旧账');
  await expect(page.getByText('1 笔历史数据还需要核对，先不把当前结果当成最终结论。', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '核对账单', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('问小满：我这个月还能花多少？')).toBeVisible();
});
