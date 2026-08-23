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

test("server-renders the branded account loading state", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>小满账本｜语音也能轻松记账<\/title>/);
  assert.match(html, /正在打开小满账本/);
  assert.match(html, /class="brand-seal">满</);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview/i);
});

test("keeps cloud persistence, isolation UI, and GitHub Pages publishing wired", async () => {
  const [page, client, workflow, manifest, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /signInWithPassword/);
  assert.match(page, /signUp/);
  assert.match(page, /financial_settings/);
  assert.match(page, /loadAdminData/);
  assert.match(page, /key: "all"/);
  assert.doesNotMatch(page, /示例账目|SAMPLE_TRANSACTIONS/);
  assert.match(client, /sb_publishable_/);
  assert.doesNotMatch(client, /service_role|secret/i);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(packageJson, /"build:github"/);
});

