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

test('AI-first home leads with trusted financial facts while manual bookkeeping stays available', async ({ page }) => {
  await open(page);
  await setup(page);

  await expect(page.getByRole('heading', { name: '小满', exact: true })).toBeVisible();
  await expect(page.getByText('你的个人财务助手', { exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-readiness')).toContainText('数据已就绪');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
  await expect(page.getByRole('heading', { name: '当前分析状态', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '小满今天想提醒你', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '问小满', exact: true })).toBeVisible();
  await expect(page.getByText('AI 分析待启用', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: '小满', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '财务', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '复盘', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '我的', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加账目', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '财务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '财务', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '消费 / 浪费 / 投资', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '投资资产', exact: true })).toBeVisible();
});

test('AI-first home downgrades certainty when legacy data still needs review', async ({ page }) => {
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

  await expect(page.getByTestId('assistant-readiness')).toContainText('待核对');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('待核对旧账');
  await expect(page.getByText('有未核对数据时，小满不会输出确定的财务阶段或安心可花结论。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '核对账单', exact: true })).toBeVisible();
});
