import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { addEntry, emptyLedger, openLedger, returnHome, seedLedger } from "./ledger-helpers";

const service = "https://ossuymtantsctyhtwnyw.supabase.co";
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
type Row = { resource: string; revision: number; payload: Record<string, unknown> };
type Change = { resource: string; expected_revision: number; payload: Record<string, unknown> };
const user = (id: string) => ({ id, aud: "authenticated", role: "authenticated", email: id === accountA ? "a@example.test" : "b@example.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" });
const session = (id: string) => ({ access_token: `test-token-${id}`, token_type: "bearer", expires_in: 3600 * 24 * 365 * 10, expires_at: 4000000000, refresh_token: `test-refresh-${id}`, user: user(id) });

async function fakeCloud(context: BrowserContext) {
  const accounts = new Map<string, Map<string, Row>>([[accountA, new Map()], [accountB, new Map()]]);
  const writes: { owner: string; changes: Change[] }[] = [];
  const authRequests = { signups: 0 };
  let failReads = false;
  let failLogin = false;
  let denySignupEmail = false;
  let holdWrite: ((route: Route, rows: Row[]) => Promise<void>) | null = null;
  let holdRead: ((route: Route, rows: Row[]) => Promise<void>) | null = null;
  await context.route(`${service}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") {
      if (failLogin) return route.fulfill({ status: 400, headers: { "x-supabase-api-version": "2024-01-01", "access-control-expose-headers": "X-Supabase-Api-Version" }, json: { code: "invalid_credentials", error_code: "invalid_credentials", message: "Invalid login credentials" } });
      const body = route.request().postDataJSON();
      const id = body.email === "b@example.test" || body.refresh_token === `test-refresh-${accountB}` ? accountB : accountA;
      return route.fulfill({ json: session(id) });
    }
    if (url.pathname === "/auth/v1/signup") {
      authRequests.signups++;
      if (denySignupEmail) return route.fulfill({ status: 400, headers: { "x-supabase-api-version": "2024-01-01", "access-control-expose-headers": "X-Supabase-Api-Version" }, json: { code: "email_address_not_authorized", error_code: "email_address_not_authorized", message: "Email address not authorized" } });
      return route.fulfill({ json: user(accountA) });
    }
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204 });
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user(route.request().headers().authorization?.endsWith(accountB) ? accountB : accountA) });
    if (!url.pathname.startsWith("/rest/v1/rpc/")) throw Error(`Unexpected mocked cloud path: ${url.pathname}`);
    const body = route.request().postDataJSON();
    const owner = body.expected_user_id;
    // This mock enforces the same identity precondition as SQL. Neither owner
    // selectors nor a changed shared client token grant access to another user.
    if (route.request().headers().authorization !== `Bearer test-token-${owner}` || !accounts.has(owner)) return route.fulfill({ status: 403, json: { code: "42501" } });
    const data = accounts.get(owner)!;
    if (url.pathname.endsWith("xiaoman_read_resources")) {
      if (failReads) return route.fulfill({ status: 503, json: { code: "unavailable" } });
      const rows = body.resources.flatMap((key: string) => data.has(key) ? [structuredClone(data.get(key)!)] : []);
      if (holdRead && body.resources.includes("ledger")) return holdRead(route, rows);
      return route.fulfill({ json: rows });
    }
    const changes: Change[] = body.changes;
    if (changes.some(change => (data.get(change.resource)?.revision ?? 0) !== change.expected_revision)) return route.fulfill({ status: 409, json: { code: "40001" } });
    const rows = changes.map(change => ({ resource: change.resource, revision: change.expected_revision + 1, payload: structuredClone(change.payload) }));
    writes.push({ owner, changes: structuredClone(changes) });
    rows.forEach(row => data.set(row.resource, row));
    if (holdWrite && changes.some(change => change.resource === "ledger")) return holdWrite(route, rows);
    return route.fulfill({ json: rows });
  });
  return { accounts, writes, authRequests, setFailReads: (value: boolean) => { failReads = value; }, setFailLogin: (value: boolean) => { failLogin = value; }, denySignupEmail: (value: boolean) => { denySignupEmail = value; }, holdWrite: (value: typeof holdWrite) => { holdWrite = value; }, holdRead: (value: typeof holdRead) => { holdRead = value; } };
}
async function my(page: Page) { await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的", exact: true }).click(); }
async function login(page: Page, email: string) {
  await my(page);
  const panel = page.getByRole("region", { name: "账号与同步" });
  await panel.locator("summary").filter({ hasText: "使用账号" }).click();
  await panel.getByLabel("邮箱（必填）").fill(email);
  await panel.getByLabel("密码（必填）").fill("Only-a-synthetic-password");
  await panel.getByRole("button", { name: "登录", exact: true }).click();
}
async function logout(page: Page) {
  if (await page.getByRole("navigation", { name: "主导航" }).count()) await my(page);
  await page.getByRole("button", { name: "退出到本机账本", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "记账或问小满", exact: true })).toBeVisible();
  await expect(page.getByTestId("account-workspace")).toHaveCount(0);
}
const home = (page: Page) => page.locator(".transactions").first();
async function preference(page: Page, keyword: string) {
  await page.getByRole("button", { name: "记忆与偏好", exact: true }).click();
  await page.getByRole("button", { name: "添加分类偏好", exact: true }).click();
  await page.getByLabel("关键词（必填）").fill(keyword);
  await page.getByLabel("性质（选填）").selectOption("投资");
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(page.getByRole("button", { name: `修改偏好：${keyword}`, exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
}

test("accounts keep guest records and preferences separate, persist cloud saves and never automatically upload", async ({ page, context }, testInfo) => {
  const cloud = await fakeCloud(context);
  await openLedger(page);
  await addEntry(page, { type: "income", amount: "7", note: "本机原有账目" });
  await preference(page, "本机课程");
  await login(page, "a@example.test");
  await expect(page.getByTestId("account-workspace")).toContainText("a@example.test");
  await expect(page.getByText("这个账号还没有账目。", { exact: false })).toBeVisible();
  expect(cloud.writes).toHaveLength(0);
  await expect(home(page)).not.toContainText("本机原有账目");
  await addEntry(page, { type: "income", amount: "11", note: "账号甲账目" });
  await preference(page, "账号甲课程");
  await page.reload();
  await expect(home(page)).toContainText("账号甲账目");
  await page.getByRole("button", { name: "记忆与偏好", exact: true }).click();
  await expect(page.getByRole("button", { name: "修改偏好：账号甲课程", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "修改偏好：本机课程", exact: true })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await logout(page);
  await expect(home(page)).toContainText("本机原有账目");
  await expect(home(page)).not.toContainText("账号甲账目");
  await login(page, "b@example.test");
  await expect(page.getByTestId("account-workspace")).toContainText("b@example.test");
  await expect(home(page)).not.toContainText("账号甲账目");
  await addEntry(page, { type: "income", amount: "22", note: "账号乙账目" });
  await logout(page); await login(page, "a@example.test");
  await expect(home(page)).toContainText("账号甲账目");
  await expect(home(page)).not.toContainText("账号乙账目");
  await my(page); await page.getByRole("button", { name: "重新同步", exact: true }).click();
  await expect(page.getByText("已读取云端最新账本，助手记忆正在重新载入。", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("account-desktop.png"), fullPage: true });
  expect(cloud.accounts.get(accountA)?.get("ledger")?.payload.transactions).toMatchObject([{ amount: 11 }]);
  expect(cloud.accounts.get(accountB)?.get("ledger")?.payload.transactions).toMatchObject([{ amount: 22 }]);
});

test("failed login preserves guest records and pilot signup waits for email confirmation at 320px", async ({ page, context }, testInfo) => {
  const cloud = await fakeCloud(context); cloud.setFailLogin(true);
  await page.setViewportSize({ width: 320, height: 640 });
  await openLedger(page); await addEntry(page, { type: "income", amount: "7", note: "登录失败仍在" });
  await login(page, "a@example.test");
  await expect(page.getByRole("alert")).toContainText("邮箱或密码不正确");
  const panel = page.getByRole("region", { name: "账号与同步" });
  await panel.getByRole("button", { name: "注册新账号", exact: true }).click();
  await expect(panel.getByText("当前仅支持已获授权的体验邮箱注册。", { exact: true })).toBeVisible();
  expect(cloud.authRequests.signups).toBe(0);
  await panel.getByRole("button", { name: "注册", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("确认邮件");
  await expect(panel.getByLabel("密码（必填）")).toHaveValue("");
  expect(cloud.authRequests.signups).toBe(1);
  await expect(page.getByTestId("account-workspace")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.clock.fastForward(5000);
  await page.screenshot({ path: testInfo.outputPath("account-pilot-signup-320px.png"), fullPage: true });
  await returnHome(page); await expect(home(page)).toContainText("登录失败仍在");
  expect(cloud.writes).toHaveLength(0);
});

test("an unauthorized signup email shows the pilot limit and keeps local bookkeeping available", async ({ page, context }, testInfo) => {
  const cloud = await fakeCloud(context); cloud.denySignupEmail(true);
  await page.setViewportSize({ width: 320, height: 640 });
  await openLedger(page); await addEntry(page, { type: "income", amount: "9", note: "注册拒绝仍在" });
  await my(page);
  const panel = page.getByRole("region", { name: "账号与同步" });
  await panel.locator("summary").filter({ hasText: "使用账号" }).click();
  await panel.getByRole("button", { name: "注册新账号", exact: true }).click();
  await panel.getByLabel("邮箱（必填）").fill("not-authorized@example.test");
  await panel.getByLabel("密码（必填）").fill("Only-a-synthetic-password");
  await panel.getByRole("button", { name: "注册", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("这个邮箱暂未开放注册，你可以继续使用本机账本。");
  await expect(panel.getByRole("status")).toHaveCount(0);
  await expect(page.getByTestId("account-workspace")).toHaveCount(0);
  expect(cloud.authRequests.signups).toBe(1); expect(cloud.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.clock.fastForward(5000);
  await page.screenshot({ path: testInfo.outputPath("account-pilot-email-denied-320px.png"), fullPage: true });
  await returnHome(page); await expect(home(page)).toContainText("注册拒绝仍在");
  await addEntry(page, { type: "income", amount: "2", note: "继续本机记账" });
  await expect(home(page)).toContainText("继续本机记账");
});

test("unavailable cloud remains visibly signed in and logout returns to the untouched guest ledger", async ({ page, context }) => {
  const cloud = await fakeCloud(context);
  await openLedger(page); await addEntry(page, { type: "income", amount: "7", note: "不可回退冒充云端" });
  cloud.setFailReads(true); await login(page, "a@example.test");
  await expect(page.getByRole("heading", { name: "账本暂时无法读取", exact: true })).toBeVisible();
  await expect(page.getByText("仍是当前账号，未切换到本机账本", { exact: true })).toBeVisible();
  await expect(page.getByText("不可回退冒充云端", { exact: true })).toHaveCount(0);
  await logout(page); await expect(home(page)).toContainText("不可回退冒充云端");
  expect(cloud.writes).toHaveLength(0);
});

test("identity changes in another tab discard dialogs and reject late account-A results without writing account B", async ({ page, context }) => {
  const cloud = await fakeCloud(context);
  await openLedger(page); await login(page, "a@example.test");
  await expect(page.getByTestId("account-workspace")).toContainText("a@example.test");
  const other = await context.newPage(); await openLedger(other);
  await expect(other.getByTestId("account-workspace")).toContainText("a@example.test");
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  let pending = false;
  cloud.holdWrite(async (route, rows) => { pending = true; await held; await route.fulfill({ json: rows }); });
  await page.getByRole("button", { name: "手动记一笔", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "记账", exact: true });
  await dialog.locator('[name="amount"]').fill("33");
  await dialog.getByRole("button", { name: "记好了", exact: true }).click();
  await expect.poll(() => pending).toBe(true);
  await logout(other); await login(other, "b@example.test");
  await expect(page.getByTestId("account-workspace")).toContainText("b@example.test");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  release!();
  await expect(home(page)).not.toContainText("33.00");
  expect(cloud.accounts.get(accountB)?.size).toBe(0);
  expect(cloud.writes.every(write => write.owner === accountA)).toBe(true);
  await other.close();
});

test("guest memory failure does not block manual bookkeeping or its existing local ledger", async ({ page, context }) => {
  await fakeCloud(context);
  const state = emptyLedger();
  await seedLedger(page, state);
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = function(name: string, version?: number) {
      if (name === "xiaoman-assistant-memory-db") throw new Error("Synthetic memory-only failure");
      return version === undefined ? open(name) : open(name, version);
    };
  });
  await openLedger(page);
  await expect(page.getByText(/Synthetic memory-only failure|对话记忆.*失败|记忆.*无法/)).toBeVisible();
  await addEntry(page, { type: "income", amount: "9", note: "记忆异常仍可手记" });
  await expect(home(page)).toContainText("记忆异常仍可手记");
});

test("copying local data requires a preview and confirmation, transfers all four resources once and preserves the guest", async ({ page, context }, testInfo) => {
  const cloud = await fakeCloud(context);
  await openLedger(page); await addEntry(page, { type: "income", amount: "17", note: "确认后才上传" });
  await preference(page, "健身课");
  await page.getByRole("textbox", { name: "记账或问小满", exact: true }).fill("这个月收入多少");
  await page.getByRole("button", { name: "发送给小满", exact: true }).click();
  await expect(page.getByTestId("ai-answer")).toContainText("17元");
  await login(page, "a@example.test"); await expect(page.getByTestId("account-workspace")).toContainText("a@example.test");
  await my(page);
  await page.getByRole("button", { name: "复制本机数据到这个账号", exact: true }).click();
  const preview = page.locator(".migration-preview");
  await expect(preview).toContainText("共 1 笔账目、2 条对话、1 条偏好");
  await expect(preview).toContainText("a@example.test");
  expect(cloud.writes).toHaveLength(0);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("account-copy-preview-320px.png"), fullPage: true });
  await page.getByRole("button", { name: "暂不复制", exact: true }).click();
  expect(cloud.writes).toHaveLength(0);
  await page.getByRole("button", { name: "复制本机数据到这个账号", exact: true }).click();
  await page.getByRole("button", { name: "确认复制到当前账号", exact: true }).click();
  await expect(page.getByText("本机账目、对话和偏好已复制到当前账号，本机原内容仍保留。", { exact: true })).toBeVisible();
  expect(cloud.writes).toHaveLength(1);
  expect(cloud.writes[0].changes.map(change => change.resource).sort()).toEqual(["ledger", "memory_family", "memory_personal", "memory_travel"]);
  await returnHome(page); await expect(home(page)).toContainText("确认后才上传");
  await page.getByRole("button", { name: "记忆与偏好", exact: true }).click();
  await expect(page.getByRole("button", { name: "修改偏好：健身课", exact: true })).toBeVisible();
  await expect(page.getByText("已保存 2 条", { exact: false })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await logout(page); await expect(home(page)).toContainText("确认后才上传");
  await page.getByRole("button", { name: "记忆与偏好", exact: true }).click();
  await expect(page.getByRole("button", { name: "修改偏好：健身课", exact: true })).toBeVisible();
});

test("copy local refuses an account that already contains a ledger without changing either source", async ({ page, context }) => {
  const cloud = await fakeCloud(context);
  await openLedger(page); await addEntry(page, { type: "income", amount: "7", note: "本机应保留" });
  await login(page, "a@example.test"); await expect(page.getByTestId("account-workspace")).toBeVisible();
  await addEntry(page, { type: "income", amount: "19", note: "云端应保留" });
  const before = structuredClone(cloud.accounts.get(accountA)?.get("ledger"));
  const count = cloud.writes.length;
  await my(page); await page.getByRole("button", { name: "复制本机数据到这个账号", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/已有|非空|不是空白/);
  await expect(page.getByRole("button", { name: "确认复制到当前账号", exact: true })).toHaveCount(0);
  expect(cloud.writes).toHaveLength(count);
  expect(cloud.accounts.get(accountA)?.get("ledger")).toEqual(before);
  await logout(page); await expect(home(page)).toContainText("本机应保留");
});

test("a delayed sync locks local edits so an old response cannot replace a newer save", async ({ page, context }) => {
  const cloud = await fakeCloud(context);
  await openLedger(page); await login(page, "a@example.test"); await expect(page.getByTestId("account-workspace")).toBeVisible();
  await addEntry(page, { type: "income", amount: "11", note: "同步前" });
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  let pending = false;
  cloud.holdRead(async (route, rows) => { pending = true; await held; await route.fulfill({ json: rows }); });
  await my(page); await page.getByRole("button", { name: "重新同步", exact: true }).click();
  await expect.poll(() => pending).toBe(true);
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "记账", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "退出到本机账本", exact: true })).toBeDisabled();
  cloud.holdRead(null); release!();
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "记账", exact: true })).toBeEnabled();
  await returnHome(page); await addEntry(page, { type: "income", amount: "19", note: "同步后" });
  await expect(home(page)).toContainText("同步前"); await expect(home(page)).toContainText("同步后");
  expect(cloud.accounts.get(accountA)?.get("ledger")?.payload.transactions).toHaveLength(2);
});
