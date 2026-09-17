import { test, expect } from '@playwright/test';
const today = new Date('2026-09-15T04:00:00Z');
test('70 5 25 suggestions preserve explicit investment edits and persist new structure', async ({page}) => {
  await page.clock.install({time:today});await page.goto('./');
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
  await page.getByRole('button',{name:'财务',exact:true}).click();
  await page.getByRole('button',{name:'调整结构',exact:true}).click();
  await page.locator('[name="availableIncome"]').fill('6000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('0');
  await page.getByRole('button',{name:'恢复 25% 投资目标'}).click();
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('1500');
  await page.getByRole('button',{name:'保存新的周期结构',exact:true}).click();
  await page.getByRole('button',{name:'小满',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥4,500.00');
  await page.reload();await expect(page.getByTestId('safe-to-spend')).toHaveText('¥4,500.00');
  await page.clock.setSystemTime(new Date('2026-09-20T04:00:00Z'));await page.reload();
  await page.getByRole('button',{name:'确认收入，开启新周期'}).click();
  await page.locator('[name="availableIncome"]').fill('3000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('750');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveCount(0);
});

test('voice start, stop, transcript, permission error and manual fallback', async ({page})=>{
  await page.addInitScript({content:`window.SpeechRecognition=class {
    constructor(){window.testRecognition=this;}
    start(){} stop(){this.onresult?.({results:[[{transcript:'午餐一碗面'}]]});this.onend?.();} abort(){}
  };`});
  await page.clock.install({time:today});await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');await page.locator('[name="availableIncome"]').fill('3000');
  await page.getByRole('button',{name:'开始这个周期',exact:true}).click();
  await page.getByRole('button',{name:'添加账目',exact:true}).click();
  await page.getByRole('button',{name:'用语音填写备注',exact:true}).click();
  await expect(page.locator('.voice-note')).toHaveClass(/listening/);
  await page.getByRole('button',{name:'停止录音',exact:true}).click();
  await expect(page.locator('[name="note"]')).toHaveValue('午餐一碗面');
  await expect(page.getByText('已填入备注，检查一下就好。')).toBeVisible();
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
  await expect(page.locator('[name="spendKind"]')).toHaveCount(0);
  await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥2,220.00');
});

test('unsupported voice leaves manual entry usable and offline artwork is cached',async({page,context})=>{
  await page.addInitScript({content:'window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;'});
  await page.clock.install({time:today});await page.goto('./');
  await page.locator('[name="salaryDay"]').fill('20');await page.locator('[name="availableIncome"]').fill('3000');
  await page.getByRole('button',{name:'开始这个周期',exact:true}).click();
  await page.getByRole('button',{name:'添加账目',exact:true}).click();
  await page.getByRole('button',{name:'用语音填写备注',exact:true}).click();
  await expect(page.getByText('这个浏览器暂不支持语音，请在上方输入备注。')).toBeVisible();
  await page.locator('[name="note"]').fill('手动记录');await page.locator('[name="amount"]').fill('10');
  await page.getByRole('button',{name:'消费',exact:true}).click();await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥2,240.00');
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBeTruthy();
  await context.setOffline(true);await page.reload();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥2,240.00');
  expect(await page.evaluate(async()=>{const r=await fetch('art/xiaoman-forest.png');return r.ok&&(await r.blob()).size>1000;})).toBeTruthy();
});