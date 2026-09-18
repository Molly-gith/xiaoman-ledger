import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-09-15T04:00:00Z') });
  await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');
  await page.locator('[name="availableIncome"]').fill('10000');
  await page.getByRole('button', { name: '开始这个周期', exact: true }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
  await page.clock.runFor(4500);
}

async function dockIsReachable(page: Page) {
  const dock = await page.locator('.assistant-dock').boundingBox();
  const input = await page.getByRole('textbox', { name: '问小满', exact: true }).boundingBox();
  expect(dock).not.toBeNull();
  expect(input).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(dock!.y + dock!.height).toBeCloseTo(viewport.height, 0);
  expect(input!.x).toBeGreaterThanOrEqual(0);
  expect(input!.x + input!.width).toBeLessThanOrEqual(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
}

for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }, { width: 320, height: 760 }, { width: 844, height: 390 }]) {
  test(`shared layout and reachable controls at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await setup(page);
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
    await dockIsReachable(page);
    for (const action of ['add', 'bills', 'assets', 'review']) {
      await expect(page.getByTestId(`home-action-${action}`)).toBeVisible();
    }
    await page.screenshot({ path: `docs/screenshots/conversation-${size.width}.png` });
    // Fixed controls must not prevent reaching the last content item.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await dockIsReachable(page);
    const last = await page.getByRole('button', { name: '记下第一笔', exact: true }).boundingBox();
    const dock = await page.locator('.assistant-dock').boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(dock!.y);
    await page.getByRole('button', { name: '记下第一笔', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '记账', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByTestId('home-action-bills').click();
    await expect(page.getByRole('heading', { name: '财务', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const back = await page.getByRole('button', { name: '返回小满', exact: true }).boundingBox();
    const heading = await page.getByRole('heading', { name: '财务', exact: true }).boundingBox();
    expect(back!.y + back!.height).toBeLessThanOrEqual(heading!.y);
    await page.getByRole('button', { name: '管理投资账户', exact: true }).click();
    await page.getByRole('button', { name: /返回/ }).click();
    await expect(page.getByRole('heading', { name: '财务', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回小满', exact: true }).click();
    await page.getByRole('button', { name: '我的设置', exact: true }).click();
    await expect(page.getByRole('button', { name: '更新存款目标', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回小满', exact: true }).click();
    await expect(page.getByTestId('assistant-conversation')).toBeVisible();
  });
}

test('quick prompt focuses input; keyboard viewport keeps send reachable and restores dock', async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: window.innerHeight, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  });
  await setup(page);
  await page.getByRole('button', { name: '这周花多了吗？', exact: true }).click();
  const input = page.getByRole('textbox', { name: '问小满', exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('这周花多了吗？');
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 480, offsetTop: 0 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.assistant-dock')).toHaveAttribute('data-keyboard', 'true');
  const composer = await page.locator('.assistant-composer').boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(480);
  expect(composer!.y).toBeGreaterThan(0);
  await page.getByRole('button', { name: '发送给小满', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('AI 分析暂未启用');
  await expect(input).toHaveValue('这周花多了吗？');
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: window.innerHeight, offsetTop: 0 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await dockIsReachable(page);
});

test('mobile and desktop evidence uses real manual-entry and asset journeys', async ({ page }) => {
  await setup(page);
  for (const [note, amount] of [['午餐', '38'], ['本周采购', '186'], ['通勤', '12']]) {
    await page.getByTestId('home-action-add').click();
    await page.locator('[name="note"]').fill(note);
    await page.locator('[name="amount"]').fill(amount);
    await page.getByRole('button', { name: '消费', exact: true }).click();
    await page.getByRole('button', { name: '记好了', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByTestId('home-action-assets').click();
  await page.locator('[name="investmentAccountName"]').fill('长期投资');
  await page.locator('[name="investmentMarketValue"]').fill('78724.8');
  await page.locator('[name="investmentOpeningContribution"]').fill('70000');
  await page.getByRole('button', { name: '保存投资账户', exact: true }).click();
  await expect(page.getByTestId('market-value')).toHaveText('¥78,724.80');
  await page.getByRole('button', { name: /返回/ }).click();
  await page.clock.runFor(4500);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.screenshot({ path: `docs/screenshots/v3-home-${width}.png` });
    for (const area of ['bills', 'assets', 'review']) {
      await page.getByTestId(`home-action-${area}`).click();
      await page.screenshot({ path: `docs/screenshots/v3-${area}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: /返回/ }).click();
    }
  }
});
