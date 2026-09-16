import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const fixedNow = new Date('2026-09-15T04:00:00Z');
async function open(page: Page) { await page.clock.install({ time: fixedNow }); await page.goto('./'); }
async function setup(page: Page) {
  await page.locator('[name="salaryDay"]').fill('20');
  await page.locator('[name="availableIncome"]').fill('10000');
  await expect(page.locator('[name="plannedSavings"]')).toHaveValue('2500');
  await expect(page.locator('[name="necessaryReserve"]')).toHaveCount(0);
  await page.getByRole('button', { name: '开始这个周期', exact: true }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
}
test('manual cycle, CRUD, rent as normal spending, nature targets, backups and offline reload', async ({ page, context }) => {
  const errors: string[]=[]; page.on('pageerror', error=>errors.push(error.message));
  await open(page);
  await mkdir('docs/screenshots', {recursive:true});
  await page.screenshot({path:'docs/screenshots/onboarding.png',fullPage:true});
  await setup(page);
  await page.getByRole('button',{name:'添加账目',exact:true}).click();
  await expect(page.getByText('这笔钱，从哪里出？')).toHaveCount(0);
  await page.locator('[name="amount"]').fill('37.8');
  await page.getByRole('button',{name:'消费',exact:true}).click();
  await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,462.20');
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('[name="amount"]').fill('100');
  await page.getByRole('button',{name:'学习',exact:false}).click();
  await page.getByRole('button',{name:'投资',exact:true}).click();
  await page.locator('[name="note"]').fill('课程');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  // Investment spending up to the protected target is not deducted twice.
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
  await page.reload();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
  await expect(page.locator('.tx-copy small')).toContainText('学习 · 投资');
  await page.getByRole('button',{name:'添加账目',exact:true}).click();
  await page.getByRole('button',{name:'收入',exact:true}).last().click();
  await page.locator('[name="amount"]').fill('10000');
  await page.locator('[name="note"]').fill('工资');
  await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
  await page.getByRole('button',{name:'添加账目',exact:true}).click();
  await page.locator('[name="amount"]').fill('3000');
  await page.getByRole('button',{name:'居住',exact:false}).click();
  await page.getByRole('button',{name:'消费',exact:true}).click();
  await expect(page.locator('[name="spendKind"]')).toHaveCount(0);
  await page.locator('[name="note"]').fill('房租');
  await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥4,500.00');
  await expect(page.getByText(/账单预留/)).toHaveCount(0);
  await page.clock.fastForward(5000);
  await page.screenshot({path:'docs/screenshots/home.png'});
  await page.getByRole('button',{name:'调整结构',exact:true}).click();
  await page.locator('[name="availableIncome"]').fill('11000');
  await page.getByRole('button',{name:'保存新的周期结构',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥5,500.00');
  const course=page.locator('.tx-row').filter({hasText:'课程'});
  await course.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥5,500.00');
  await page.getByRole('button',{name:'本地数据与备份',exact:true}).click();
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出完整备份',exact:false}).click();
  const backup=await pending; const path=await backup.path(); expect(path).toBeTruthy();
  await page.getByRole('button',{name:'清空这台设备的数据',exact:true}).click();
  await page.getByRole('button',{name:'确认清空',exact:true}).click();
  await expect(page.locator('[name="salaryDay"]')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(path!);
  await page.getByRole('button',{name:'确认恢复',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥5,500.00');
  await page.reload(); await expect(page.getByTestId('safe-to-spend')).toHaveText('¥5,500.00');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true); await page.reload();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥5,500.00');
  expect(errors).toEqual([]);
});
test('legacy data requires confirmation and manual editing preserves user choices',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('xiaoman-ledger-local-v1',JSON.stringify({app:'xiaoman-ledger',version:1,ledgerKind:'personal',settings:{monthlyBudget:15000,savingsCurrent:0,savingsGoal:100000},transactions:[{id:'old',type:'expense',amount:50,date:'2026-09-15',category:'购物',note:'旧账',icon:'购',source:'text'}]})));
  await open(page);
  await page.locator('[name="salaryDay"]').fill('20'); await page.locator('[name="availableIncome"]').fill('1000');
  await page.locator('[name="plannedSavings"]').fill('0');
  await page.getByRole('button',{name:'开始这个周期',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('待核对旧账');
  await page.getByRole('button',{name:'核对账单',exact:true}).click();
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('button',{name:'浪费',exact:true}).click();
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByRole('button',{name:'首页',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥950.00');
});
test('stale tabs cannot overwrite newer data',async({page,context})=>{
  await open(page);await setup(page);
  const second=await context.newPage();await open(second);await expect(second.getByTestId('safe-to-spend')).toHaveText('¥7,500.00');
  await page.getByRole('button',{name:'调整结构',exact:true}).click();await page.locator('[name="availableIncome"]').fill('12000');await page.getByRole('button',{name:'保存新的周期结构',exact:true}).click();
  await second.getByRole('button',{name:'调整结构',exact:true}).click();await second.locator('[name="availableIncome"]').fill('9000');await second.getByRole('button',{name:'保存新的周期结构',exact:true}).click();
  await expect(second.getByRole('alert')).toContainText('其他页面更新');
  await second.getByRole('button',{name:'重新载入账本',exact:true}).click();await expect(second.getByTestId('safe-to-spend')).toHaveText('¥9,500.00');
});
test('zero income, negative period spendable and salary rollover preserve history',async({page})=>{
  await open(page);await page.locator('[name="salaryDay"]').fill('20');await page.locator('[name="availableIncome"]').fill('0');
  await page.getByRole('button',{name:'开始这个周期',exact:true}).click();await expect(page.getByTestId('safe-to-spend')).toHaveText('¥0.00');
  await page.getByRole('button',{name:'添加账目',exact:true}).click();await page.locator('[name="amount"]').fill('10');await page.getByRole('button',{name:'消费',exact:true}).click();await page.getByRole('button',{name:'记好了',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥-10.00');
  await page.clock.setFixedTime(new Date('2026-09-20T04:00:00Z'));await page.reload();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('请开启新周期');
  await page.getByRole('button',{name:'确认收入，开启新周期',exact:true}).click();await page.locator('[name="availableIncome"]').fill('100');await page.locator('[name="plannedSavings"]').fill('0');await page.getByRole('button',{name:'开始这个周期',exact:true}).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('¥100.00');
  await page.getByRole('button',{name:'账单',exact:true}).click();await expect(page.locator('.tx-row')).toHaveCount(1);
});
test('failed durable write retains the form and does not report success',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('xiaoman-ledger-local-v1',JSON.stringify({app:'xiaoman-ledger',version:2,revision:0,ledgerKind:'personal',profile:null,activeCycleId:null,cycles:[],budgets:[],transactions:[],settings:{monthlyBudget:0,savingsCurrent:0,savingsGoal:0}}));
    Storage.prototype.setItem=()=>{throw new DOMException('空间不足','QuotaExceededError');};
  });
  await open(page);await page.locator('[name="salaryDay"]').fill('20');await page.locator('[name="availableIncome"]').fill('100');
  await page.getByRole('button',{name:'开始这个周期',exact:true}).click();await expect(page.getByRole('alert')).toContainText('空间不足');
  await expect(page.locator('[name="availableIncome"]')).toHaveValue('100');await expect(page.getByTestId('safe-to-spend')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('xiaoman-ledger-local-v1')!).revision)).toBe(0);
});
test('online navigation refreshes an older offline shell after an app update',async({page})=>{
  await open(page);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();await expect(page.locator('[name="salaryDay"]')).toBeVisible();
  await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready, cache=await caches.open('xiaoman-shell-v3');
    await cache.put(new URL('./',registration.scope),new Response('<html>old-release-marker</html>',{headers:{'content-type':'text/html'}}));
  });
  await page.reload();await expect(page.locator('[name="salaryDay"]')).toBeVisible();
  await expect.poll(()=>page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready, cache=await caches.open('xiaoman-shell-v3');
    return (await (await cache.match(new URL('./',registration.scope)))!.text()).includes('old-release-marker');
  })).toBe(false);
  await page.context().setOffline(true);await page.reload();await expect(page.locator('[name="salaryDay"]')).toBeVisible();
});
test('ambiguous legacy timestamps require an explicit date instead of a timezone guess',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('xiaoman-ledger-local-v1',JSON.stringify({
    app:'xiaoman-ledger',version:2,revision:1,ledgerKind:'personal',profile:{salaryDay:20},activeCycleId:'cycle-2026-08-20-20',
    cycles:[{id:'cycle-2026-08-20-20',salaryDay:20,startDate:'2026-08-20',endDate:'2026-09-19',nextSalaryDate:'2026-09-20'}],
    budgets:[{cycleId:'cycle-2026-08-20-20',availableIncome:1000,plannedSavings:0,necessaryReserve:0}],
    transactions:[{id:'old',type:'expense',amount:50,date:'2026-08-19T16:30:00Z',cycleId:'cycle-2026-08-20-20',nature:'消费',spendKind:'variable',category:'餐饮',note:'旧时间记录',icon:'餐',source:'text'}],
    settings:{monthlyBudget:0,savingsCurrent:0,savingsGoal:0}
  })));
  await open(page);await expect(page.getByTestId('safe-to-spend')).toHaveText('待核对旧账');
  await page.getByRole('button',{name:'核对账单',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();
  await expect(page.locator('[name="date"]')).toHaveValue('');
  await expect(page.locator('[name="spendKind"]')).toHaveCount(0);
  await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('[name="date"]').fill('2026-08-20');await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByRole('button',{name:'首页',exact:true}).click();await expect(page.getByTestId('safe-to-spend')).toHaveText('¥950.00');
});