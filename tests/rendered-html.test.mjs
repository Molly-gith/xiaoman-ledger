import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the branded local-ledger loading state", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>小满账本｜把日子，过成喜欢的样子<\/title>/);
  assert.match(html, /正在打开本地账本/);
  assert.match(html, /class="brand-seal">满</);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/i);
});

test("keeps local persistence, portable backups, and GitHub Pages publishing wired", async () => {
  const [page, workflow, manifest, packageJson, adapter, components] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/data/local-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ledger-components.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(adapter, /indexedDB\.open/);
  assert.doesNotMatch(page, /indexedDB|localStorage/);
  assert.match(components, /导出完整备份/);
  assert.match(components, /导入备份/);
  assert.match(components, /导出表格/);
  assert.match(components, /只保存在这台设备/);
  assert.match(page, /key: "all"/);
  assert.doesNotMatch(page, /示例账目|SAMPLE_TRANSACTIONS/);
  assert.doesNotMatch(page, /supabase|signInWithPassword|signUp|loadAdminData/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(packageJson, /"build:github"/);
});

