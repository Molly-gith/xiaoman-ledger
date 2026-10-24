import { test, expect, type Page } from "@playwright/test";
import { addEntry, emptyLedger, expectReport, exportLedger, openLedger, returnHome, seedLedger } from "./ledger-helpers";

const names = { personal: "个人账本", family: "家庭账本", travel: "旅行账本" } as const;
type Kind = keyof typeof names;
const kinds: Kind[] = ["personal", "family", "travel"];
const endpoint = "https://xiaoman-ai-test.example/api/ai/assistant";
const input = (page: Page) => page.getByRole("textbox", { name: "记账或问小满", exact: true });
const preview = (page: Page) => page.getByRole("region", { name: "待保存账目" });
const currentBook = (page: Page, kind: Kind) => page.getByRole("button", { name: `切换账本，当前：${names[kind]}`, exact: true });

async function switchBook(page: Page, kind: Kind) {
  await page.getByRole("button", { name: /^切换账本，当前：/ }).click();
  const dialog = page.getByRole("dialog", { name: "切换账本", exact: true });
  await dialog.getByRole("button", { name: names[kind], exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(currentBook(page, kind)).toBeVisible();
  await expect(currentBook(page, kind)).toContainText(names[kind]);
}

async function send(page: Page, text: string) {
  await input(page).fill(text);
  await page.getByRole("button", { name: "发送给小满", exact: true }).click();
}

const draft = (extra: Record<string, unknown> = {}) => ({
  type: "expense", amount: 77, category: "餐饮", occurred_at: "2026-09-15", note: "待确认午饭",
  nature_suggestion: "消费", confidence: 0.9, ambiguous: false, ...extra,
});
const transactions = (drafts: unknown[]) => ({ status: "transactions", drafts, modelVersion: "test-only", workflowVersion: "test-only" });

test("personal, family and travel keep manual income, expense, statistics and current-book labels separate", async ({ page }) => {
  await openLedger(page);
  for (const [index, kind] of kinds.entries()) {
    if (kind !== "personal") await switchBook(page, kind);
    await expect(currentBook(page, kind)).toBeVisible();
    await expect(page.locator(".transactions .tx-row:visible")).toHaveCount(0);
    await addEntry(page, { type: "income", amount: String((index + 1) * 1000), note: `${names[kind]}收入` });
    await addEntry(page, { amount: String((index + 1) * 10), note: `${names[kind]}支出`, nature: ["消费", "浪费", "投资"][index] });
    await returnHome(page);
  }
  for (const [index, kind] of kinds.entries()) {
    await switchBook(page, kind);
    await expect(page.locator(".transactions .tx-row:visible")).toHaveCount(2);
    await expect(page.locator(".transactions:visible")).toContainText(`${names[kind]}收入`);
    for (const other of kinds.filter(value => value !== kind)) await expect(page.locator(".transactions:visible")).not.toContainText(names[other]);
    await expectReport(page, `¥${index + 1},000.00`, `¥${(index + 1) * 10}.00`, ["¥990.00", "¥1,980.00", "¥2,970.00"][index]);
    const nature = ["¥0.00", "¥0.00", "¥0.00", "¥0.00"];
    nature[index] = `¥${(index + 1) * 10}.00`;
    await expect(page.locator(".nature-summary strong")).toHaveText(nature);
    await expect(currentBook(page, kind)).toBeVisible();
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的", exact: true }).click();
    await expect(currentBook(page, kind)).toBeVisible();
    await returnHome(page);
    if (kind === "family") {
      await page.clock.runFor(4501);
      await expect(page.locator(".toast")).toHaveCount(0);
      await page.screenshot({ path: "test-results/multi-ledger-family-home.png", fullPage: true });
      await currentBook(page, kind).click();
      await expect(page.getByRole("dialog", { name: "切换账本", exact: true })).toBeVisible();
      await page.screenshot({ path: "test-results/multi-ledger-switch-menu.png", fullPage: true });
      await page.getByRole("dialog", { name: "切换账本", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    }
  }
  await page.reload();
  await expect(currentBook(page, "travel")).toBeVisible();
  await expectReport(page, "¥3,000.00", "¥30.00", "¥2,970.00");
});

test("data-panel switching and complete backup restore retain all three books and the selected book", async ({ page }) => {
  await openLedger(page);
  for (const [index, kind] of kinds.entries()) {
    if (kind !== "personal") {
      await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: names[kind], exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(currentBook(page, kind)).toBeVisible();
    }
    await addEntry(page, { amount: String((index + 1) * 11), note: `${names[kind]}备份记录` });
  }
  const { state, path } = await exportLedger(page);
  expect(state.version).toBe(4);
  expect(state.ledgerKind).toBe("travel");
  expect(Object.keys(state.otherLedgers).sort()).toEqual(["family", "personal"]);
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0]).toMatchObject({ amount: 33, note: "旅行账本备份记录" });
  expect(state.otherLedgers.personal.transactions).toHaveLength(1);
  expect(state.otherLedgers.personal.transactions[0]).toMatchObject({ amount: 11, note: "个人账本备份记录" });
  expect(state.otherLedgers.family.transactions).toHaveLength(1);
  expect(state.otherLedgers.family.transactions[0]).toMatchObject({ amount: 22, note: "家庭账本备份记录" });
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.getByRole("button", { name: "清空这台设备的数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  for (const kind of kinds) {
    await switchBook(page, kind);
    await expectReport(page, "¥0.00", "¥0.00", "¥0.00");
    await returnHome(page);
  }
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(currentBook(page, "travel")).toBeVisible();
  for (const [index, kind] of kinds.entries()) {
    await switchBook(page, kind);
    await expectReport(page, "¥0.00", `¥${(index + 1) * 11}.00`, `¥-${(index + 1) * 11}.00`);
    await expect(page.locator(".bill-list .tx-row")).toHaveCount(1);
    await expect(page.locator(".bill-list")).toContainText(`${names[kind]}备份记录`);
    await returnHome(page);
  }
});

test("legacy labeled books retain their records during v4 migration without cloning them into other books", async ({ page }) => {
  await seedLedger(page, { ...emptyLedger(), ledgerKind: "travel", revision: 3, transactions: [{
    id: "legacy-travel", type: "expense", amount: 45, date: "2026-09-15", category: "交通", note: "原旅行交通",
    icon: "行", source: "text", cycleId: null, nature: "消费", spendKind: "variable",
  }] });
  await openLedger(page);
  await expect(currentBook(page, "travel")).toBeVisible();
  await expectReport(page, "¥0.00", "¥45.00", "¥-45.00");
  for (const kind of ["personal", "family"] as const) {
    await switchBook(page, kind);
    await expectReport(page, "¥0.00", "¥0.00", "¥0.00");
  }
  await switchBook(page, "travel");
  await expectReport(page, "¥0.00", "¥45.00", "¥-45.00");
  await expect(page.locator(".bill-list .tx-row")).toHaveCount(1);
  await expect(page.locator(".bill-list")).toContainText("原旅行交通");
});

test("a stale tab cannot save its manual entry into a book selected by another tab", async ({ page, context }) => {
  await openLedger(page);
  const stale = await context.newPage();
  await openLedger(stale);
  await stale.getByRole("button", { name: "手动记一笔", exact: true }).click();
  await stale.locator('[name="amount"]').fill("90");
  await stale.locator('[name="category"]').selectOption("餐饮");
  await stale.getByRole("dialog").getByRole("button", { name: "消费", exact: true }).click();
  await switchBook(page, "family");
  await addEntry(page, { amount: "20", note: "家庭已保存" });
  await stale.getByRole("button", { name: "记好了", exact: true }).click();
  await expect(stale.getByRole("alert")).toContainText("其他页面更新");
  await expect(stale.locator('[name="amount"]')).toHaveValue("90");
  await stale.getByRole("button", { name: "重新载入账本", exact: true }).click();
  await expect(currentBook(stale, "family")).toBeVisible();
  await expectReport(stale, "¥0.00", "¥20.00", "¥-20.00");
  await expect(stale.locator(".bill-list .tx-row")).toHaveCount(1);
  await switchBook(stale, "personal");
  await expectReport(stale, "¥0.00", "¥0.00", "¥0.00");
});

test.describe("multi-ledger assistant isolation", () => {
  test.skip(process.env.AI_BROWSER_TEST !== "1", "Run against the AI-enabled mock endpoint build");

  test("AI drafts and aggregate requests use only the current book for all three books", async ({ page }) => {
    const requests: Array<{ report: { transactionCount: number; income: number; expense: number }; [key: string]: unknown }> = [];
    await page.route(endpoint, route => {
      const index = requests.length;
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: transactions([
        draft({ amount: (index + 1) * 5, note: `${names[kinds[index]]}AI支出` }),
        draft({ type: "income", amount: (index + 1) * 100, category: "收入", nature_suggestion: null, note: `${names[kinds[index]]}AI收入` }),
      ]) });
    });
    await openLedger(page);
    for (const [index, kind] of kinds.entries()) {
      if (kind !== "personal") await switchBook(page, kind);
      await addEntry(page, { amount: String((index + 1) * 10), note: `${names[kind]}私人备注不上传` });
      await send(page, "记录收入和午饭");
      await expect(preview(page)).toContainText("2 笔 · 尚未保存");
      expect(requests[index].report).toMatchObject({ transactionCount: 1, income: 0, expense: (index + 1) * 10 });
      expect(Object.keys(requests[index]).sort()).toEqual(["context", "report", "text"]);
      expect(JSON.stringify(requests[index])).not.toMatch(/私人备注|transactions|otherLedgers|ledgerKind|个人账本|家庭账本|旅行账本/);
      await preview(page).getByRole("button", { name: "保存这 2 笔", exact: true }).click();
      await expect(preview(page)).toHaveCount(0);
      await expect(page.locator(".transactions .tx-row:visible")).toHaveCount(3);
      await expectReport(page, `¥${(index + 1) * 100}.00`, `¥${(index + 1) * 15}.00`, `¥${(index + 1) * 85}.00`);
      await returnHome(page);
    }
    for (const [index, kind] of kinds.entries()) {
      await switchBook(page, kind);
      await expect(page.locator(".transactions .tx-row:visible")).toHaveCount(3);
      await expectReport(page, `¥${(index + 1) * 100}.00`, `¥${(index + 1) * 15}.00`, `¥${(index + 1) * 85}.00`);
      await returnHome(page);
    }
    expect(requests).toHaveLength(3);
  });

  test("switching books discards unconfirmed drafts and cannot move them to the new book", async ({ page }) => {
    let calls = 0;
    await page.route(endpoint, route => { calls++; return route.fulfill({ json: transactions([draft()]) }); });
    await openLedger(page);
    await send(page, "今天午饭77元");
    await expect(preview(page)).toContainText("¥77.00");
    await switchBook(page, "family");
    await expect(preview(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "保存这笔", exact: true })).toHaveCount(0);
    await expect(input(page)).toHaveValue("");
    await expectReport(page, "¥0.00", "¥0.00", "¥0.00");
    await returnHome(page);
    await switchBook(page, "personal");
    await expect(preview(page)).toHaveCount(0);
    await expectReport(page, "¥0.00", "¥0.00", "¥0.00");
    expect(calls).toBe(1);
  });

  for (const resultType of ["transactions", "answer"] as const) {
    test(`late ${resultType} from the previous book cannot appear after switching`, async ({ page }) => {
      let release: (() => void) | undefined, calls = 0;
      let delivered: (() => void) | undefined;
      const settled = new Promise<void>(resolve => { delivered = resolve; });
      await page.route(endpoint, async route => {
        calls++;
        await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ json: resultType === "transactions" ? transactions([draft()]) : { status: "answer", answer: "旧账本的迟到回答", nextActions: [] } }).catch(() => {});
        delivered?.();
      });
      await openLedger(page);
      await send(page, "我刚才记的是什么？");
      await expect.poll(() => calls).toBe(1);
      await switchBook(page, "family");
      release?.();
      await settled;
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(preview(page)).toHaveCount(0);
      await expect(page.getByTestId("ai-answer")).toHaveCount(0);
      await expect(input(page)).toHaveValue("");
      await expect(page.locator(".transactions .tx-row:visible")).toHaveCount(0);
      await switchBook(page, "personal");
      await expect(preview(page)).toHaveCount(0);
      await expect(page.getByTestId("ai-answer")).toHaveCount(0);
      expect(calls).toBe(1);
    });
  }

  test("a stale-tab AI confirmation cannot save drafts into another tab's selected book", async ({ page, context }) => {
    await context.route(endpoint, route => route.fulfill({ json: transactions([draft()]) }));
    await openLedger(page);
    const stale = await context.newPage();
    await openLedger(stale);
    await send(stale, "午饭77元");
    await expect(preview(stale)).toContainText("¥77.00");
    await switchBook(page, "family");
    await addEntry(page, { amount: "20", note: "家庭已保存" });
    await preview(stale).getByRole("button", { name: "保存这笔", exact: true }).click();
    await expect(stale.getByRole("alert")).toContainText("其他页面更新");
    await stale.getByRole("button", { name: "重新载入账本", exact: true }).click();
    await expect(currentBook(stale, "family")).toBeVisible();
    await expect(preview(stale)).toHaveCount(0);
    await expectReport(stale, "¥0.00", "¥20.00", "¥-20.00");
    await switchBook(stale, "personal");
    await expectReport(stale, "¥0.00", "¥0.00", "¥0.00");
  });
});
