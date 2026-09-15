import { test, expect } from '@playwright/test';
const today = new Date('2026-09-15T04:00:00Z');
test('salary suggestions recalculate untouched fields and preserve edits, zero and saved budgets', async ({page}) => {
  await page.clock.install({time:today});await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');
  await page.locator('[name="availableIncome"]').fill('3000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('450');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveValue('1050');
  await expect(page.getByTestId('budget-preview')).toHaveText('¥1,500.00');
  await page.locator('[name="plannedSavings"]').fill('0');
  await page.locator('[name="availableIncome"]').fill('4000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('0');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveValue('1400');
  await page.locator('[name="necessaryReserve"]').fill('1000');
  await page.locator('[name="availableIncome"]').fill('5000');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveValue('1000');
  await page.getByRole('button',{name:'生成安心可花',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥4,000.00');
  await page.getByRole('button',{name:'调整预算',exact:true}).click();
  await page.locator('[name="availableIncome"]').fill('6000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('0');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveValue('1000');
  await page.getByRole('button',{name:'重新按 15% / 35% 填入建议'}).click();
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('900');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveValue('2100');
  await page.getByRole('button',{name:'保存周期预算',exact:true}).click();
  // Wait for the completed write before navigating away, then verify persistence.
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥3,000.00');
  await page.reload();await expect(page.getByTestId('safe-to-spend')).toHaveText('¥3,000.00');
  await page.clock.setSystemTime(new Date('2026-09-20T04:00:00Z'));await page.reload();
  await page.getByRole('button',{name:'确认收入，开启新周期'}).click();
  await page.locator('[name="availableIncome"]').fill('3000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('450');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveValue('1050');
});

test('voice start, stop, transcript, permission error and manual fallback', async ({page})=>{
  await page.addInitScript({content:`window.SpeechRecognition=class {
    constructor(){window.testRecognition=this;}
    start(){} stop(){this.onresult?.({results:[[{transcript:'午餐一碗面'}]]});this.onend?.();} abort(){}
  };`});
  await page.clock.install({time:today});await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');await page.locator('[name="availableIncome"]').fill('3000');
  await page.getByRole('button',{name:'生成安心可花',exact:true}).click();
  await page.getByRole('button',{name:'添加账目',exact:true}).click();
  await page.getByRole('button',{name:'用语音填写备注',exact:true}).click();
  await expect(page.locator('.voice-note')).toHaveClass(/listening/);
  await page.getByRole('button',{name:'停止录音',exact:true}).click();
  await expect(page.locator('[name="note"]')).toHaveValue('午餐一碗面');
  await expect(page.getByText('已填入备注，检查一下就好。')).toBeVisible();
  // A failed stop must not leave a timer that cancels a later retry.
  await page.getByRole('button',{name:'用语音填写备注',exact:true}).click();
  await page.evaluate(()=>{(window as unknown as {testRecognition:{stop:()=>void}}).testRecognition.stop=()=>{throw new Error('device stopped');};});
  await page.getByRole('button',{name:'停止录音',exact:true}).click();
  await expect(page.getByText('录音未能完成，请重试或直接输入备注。')).toBeVisible();
  await page.getByRole('button',{name:'用语音填写备注',exact:true}).click();
  await page.clock.fastForward(13000);
  await expect(page.getByRole('button',{name:'停止录音',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'停止录音',exact:true}).click();
  await expect(page.getByText('已填入备注，检查一下就好。')).toBeVisible();
  await page.getByRole('button',{name:'用语音填写备注',exact:true}).click();
  await page.evaluate(()=>{(window as unknown as {testRecognition:{onerror:(e:{error:string})=>void;onend:()=>void}}).testRecognition.onerror({error:'not-allowed'});});
  await expect(page.getByText(/麦克风未获授权/)).toBeVisible();
  await expect(page.locator('[name="note"]')).toHaveValue('午餐一碗面');
  await page.locator('[name="amount"]').fill('30');
  await page.getByRole('button',{name:'消费',exact:true}).click();
  await page.locator('[name="spendKind"][value="variable"]').check();
  await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥1,470.00');
});

test('unsupported voice leaves manual entry usable and offline artwork is cached',async({page,context})=>{
  await page.addInitScript({content:'window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;'});
  await page.clock.install({time:today});await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');await page.locator('[name="availableIncome"]').fill('3000');
  await page.getByRole('button',{name:'生成安心可花',exact:true}).click();
  await page.getByRole('button',{name:'添加账目',exact:true}).click();
  await page.getByRole('button',{name:'用语音填写备注',exact:true}).click();
  await expect(page.getByText('这个浏览器暂不支持语音，请在上方输入备注。')).toBeVisible();
  await page.locator('[name="note"]').fill('手动记录');await page.locator('[name="amount"]').fill('10');
  await page.getByRole('button',{name:'消费',exact:true}).click();await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBeTruthy();
  await context.setOffline(true);await page.reload();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥1,490.00');
  expect(await page.evaluate(async()=>{const r=await fetch('art/xiaoman-forest.png');return r.ok&&(await r.blob()).size>1000;})).toBeTruthy();
});
