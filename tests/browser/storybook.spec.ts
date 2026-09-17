import { test, expect } from '@playwright/test';
const today = new Date('2026-09-15T04:00:00Z');

test('70 5 25 suggestions preserve explicit investment edits and persist new structure', async ({page}) => {
  await page.clock.install({time:today});
  await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');
  await page.locator('[name="availableIncome"]').fill('3000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('750');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveCount(0);
  await expect(page.getByTestId('budget-preview')).toHaveText('¥2,250.00');
  await expect(page.getByText('消费参考')).toBeVisible();
  await expect(page.getByText('浪费上限')).toBeVisible();
  await expect(page.getByText('投资目标',{exact:false}).first()).toBeVisible();
  await page.locator('[name="plannedSavings"]').fill('0');
  await page.locator('[name="availableIncome"]').fill('4000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('0');
  await expect(page.getByTestId('budget-preview')).toHaveText('¥4,000.00');
  await page.getByRole('button',{name:'开始这个周期',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥4,000.00');
  await page.getByTestId('home-action-bills').click();
  await page.getByRole('button',{name:'调整结构',exact:true}).click();
  await page.locator('[name="availableIncome"]').fill('6000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('0');
  await page.getByRole('button',{name:'恢复 25% 投资目标'}).click();
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('1500');
  await page.getByRole('button',{name:'保存新的周期结构',exact:true}).click();
  await expect(page.getByText(/周期结构已保存/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥4,500.00');
  await page.clock.setSystemTime(new Date('2026-09-20T04:00:00Z'));
  await page.reload();
  await page.getByRole('button',{name:'确认收入，开启新周期'}).click();
  await page.locator('[name="availableIncome"]').fill('3000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('750');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveCount(0);
});

test('conversation-first v3 keeps chat primary, removes visible tabbar and keeps four actions one tap away', async ({page})=>{
  await page.clock.install({time:today});
  await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');
  await page.locator('[name="availableIncome"]').fill('3000');
  await page.getByRole('button',{name:'开始这个周期',exact:true}).click();
  await expect(page.getByTestId('assistant-conversation')).toBeVisible();
  await expect(page.getByPlaceholder('问小满：我这个月还能花多少？')).toBeVisible();
  await expect(page.getByText('AI 分析暂未启用',{exact:false})).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(page.getByTestId('home-action-add')).toBeVisible();
  await expect(page.getByTestId('home-action-bills')).toBeVisible();
  await expect(page.getByTestId('home-action-assets')).toBeVisible();
  await expect(page.getByTestId('home-action-review')).toBeVisible();

  await page.getByTestId('home-action-add').click();
  await expect(page.getByRole('dialog',{name:'记账'})).toBeVisible();
  await page.getByRole('button',{name:'关闭'}).click();

  await page.getByTestId('home-action-bills').click();
  await expect(page.getByRole('heading',{name:'财务',exact:true})).toBeVisible();
  await page.reload();

  await page.getByTestId('home-action-assets').click();
  await expect(page.getByText('投资账户',{exact:true}).first()).toBeVisible();
  await page.reload();

  await page.getByTestId('home-action-review').click();
  await expect(page.getByRole('heading',{name:'周期复盘',exact:true})).toBeVisible();
});

test('manual entry remains usable after v3 navigation changes',async({page})=>{
  await page.clock.install({time:today});
  await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');
  await page.locator('[name="availableIncome"]').fill('3000');
  await page.getByRole('button',{name:'开始这个周期',exact:true}).click();
  await page.getByTestId('home-action-add').click();
  await page.locator('[name="note"]').fill('手动记录');
  await page.locator('[name="amount"]').fill('10');
  await page.getByRole('button',{name:'消费',exact:true}).click();
  await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥2,240.00');
  await page.reload();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥2,240.00');
});