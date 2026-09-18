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

async function expectComposerAtBottom(page: Page) {
  await expect(page.locator('.assistant-composer')).toBeVisible();
  expect(await page.locator('.assistant-composer').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom <= window.innerHeight + 2 && rect.bottom >= window.innerHeight - 36;
  })).toBeTruthy();
}

test('conversation-first v4 keeps trusted facts, bottom composer and task-oriented capability entries', async ({ page }) => {
  await open(page);
  await setup(page);

  await expect(page.getByRole('heading', { name: '小满', exact: true })).toBeVisible();
  await expect(page.getByText('你的个人财务助手', { exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-conversation')).toBeVisible();
  await expect(page.getByTestId('assistant-readiness')).toContainText('数据已就绪');
  await expect(page.getByText('这个周期整体还稳。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
  await expect(page.getByPlaceholder('问小满：我这个月还能花多少？')).toBeVisible();
  await expect(page.getByText('AI 分析暂未启用 · 记账与财务看板可正常使用', { exact: true })).toBeVisible();
  await expect(page.getByText('这周花多了吗？', { exact: true })).toBeVisible();
  await expectComposerAtBottom(page);

  await expect(page.getByTestId('home-action-add')).toContainText('记一笔');
  await expect(page.getByTestId('home-action-bills')).toContainText('看看这个月');
  await expect(page.getByTestId('home-action-assets')).toContainText('我的资产');
  await expect(page.getByTestId('home-action-review')).toContainText('帮我复盘');
  await expect(page.locator('.bottom-nav')).toBeHidden();

  await page.screenshot({ path: 'docs/screenshots/v04-conversation-home.png', fullPage: true });

  await page.getByTestId('home-action-bills').click();
  await expect(page.getByRole('heading', { name: '财务', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '消费 / 浪费 / 投资', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '投资资产', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/v04-finance.png', fullPage: true });

  await page.reload();
  await page.getByTestId('home-action-assets').click();
  await expect(page.getByText('投资账户', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/v04-assets.png', fullPage: true });

  await page.reload();
  await page.getByTestId('home-action-review').click();
  await expect(page.getByRole('heading', { name: '周期复盘', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/v04-review.png', fullPage: true });

  await page.reload();
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(page.getByTestId('assistant-conversation')).toBeVisible();
  await expectComposerAtBottom(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await page.evaluate(() => {
    const dock = document.querySelector('.assistant-composer')?.getBoundingClientRect();
    const shell = document.querySelector('.app-shell')?.getBoundingClientRect();
    return !!dock && !!shell && dock.left >= shell.left - 1 && dock.right <= shell.right + 1;
  })).toBeTruthy();
  await page.screenshot({ path: 'docs/screenshots/v04-home-320.png', fullPage: true });
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
  await expect(page.getByText('先把几笔旧账核对清楚，我再给你更确定的判断。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '核对账单', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('问小满：我这个月还能花多少？')).toBeVisible();
  await expectComposerAtBottom(page);
});
