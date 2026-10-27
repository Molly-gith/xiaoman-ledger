import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { BETA_TOKEN, PROVIDER_KEY, questionBody } from "./ai-fixture.mjs";
import { requestBody as assistantBody } from "./ai-assistant-fixture.mjs";

const projectDir = fileURLToPath(new URL("../", import.meta.url));

test("compiled Vercel API loads, isolates credentials and selects a valid limiter host", async () => {
  const outputParent = join(projectDir, ".vercel");
  await mkdir(outputParent, { recursive: true });
  const outputDir = await mkdtemp(join(outputParent, "ai-compiled-test-"));
  try {
    const config = ts.readConfigFile(join(projectDir, "tsconfig.json"), ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectDir);
    const program = ts.createProgram({
      rootNames: [join(projectDir, "api/ai/question.ts"), join(projectDir, "api/ai/assistant.ts")],
      options: { ...parsed.options, rootDir: projectDir, outDir: outputDir, noEmit: false, incremental: false, declaration: false, sourceMap: false },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => projectDir, getNewLine: () => "\n",
    }));
    assert.equal(program.emit().emitSkipped, false);
    const entrypoint = join(outputDir, "api/ai/question.js");
    const entryCode = await readFile(entrypoint, "utf8");
    assert.match(entryCode, /question-handler\.js/);
    assert.doesNotMatch(entryCode, /question-handler\.ts/);
    const assistantEntrypoint = join(outputDir, "api/ai/assistant.js");
    const assistantCode = await readFile(assistantEntrypoint, "utf8");
    assert.match(assistantCode, /assistant-handler\.js/);
    assert.doesNotMatch(assistantCode, /assistant-handler\.ts/);

    // A fresh process receives only non-secret test configuration. Source .ts files
    // are absent from this output tree, matching Vercel's compiled file layout.
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      const { default: api } = await import(process.argv[1]);
      const { default: assistant } = await import(process.argv[3]);
      const url = "https://api.example.test/api/ai/question";
      const origin = "https://molly-gith.github.io";
      assert.equal((await api.fetch(new Request(url, { method: "OPTIONS", headers: { Origin: origin } }))).status, 204);
      const response = await api.fetch(new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" }));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "not_configured" });
      assert.equal((await api.fetch(new Request(url, { method: "POST", headers: { Origin: "https://untrusted.example" } }))).status, 403);

      // Synthetic configuration only: no parent secrets or credentials enter this process.
      const fixture = JSON.parse(process.argv[2]);
      Object.assign(process.env, {
        VERCEL: "1", AI_BETA_TOKEN: fixture.token, DIFY_API_KEY: fixture.providerKey,
        DIFY_MODEL_VERSION: "test-model", DIFY_WORKFLOW_VERSION: "test-workflow",
      });
      let calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(null, { status: 429 });
      };
      const invoke = (ip = "203.0.113.7", target = api, targetUrl = url, body = fixture.body) => target.fetch(new Request(targetUrl, {
        method: "POST", body: JSON.stringify(body), headers: {
          Origin: origin, "Content-Type": "application/json",
          Authorization: "Bearer " + fixture.token, Cookie: "private-cookie=test",
          Host: "attacker.example", "X-Forwarded-Host": "attacker.example",
          "x-vercel-forwarded-for": ip, "X-Forwarded-For": "198.51.100.1", "X-Real-IP": "198.51.100.2",
        },
      }));
      const productionHost = "xiaoman-ai-beta.vercel.app";
      const deploymentHost = "xiaoman-ai-beta-test-deployment.vercel.app";
      let firstBucket;
      for (const [environment, expectedHost] of [["production", productionHost], ["preview", deploymentHost]]) {
        Object.assign(process.env, {
          VERCEL_ENV: environment, VERCEL_PROJECT_PRODUCTION_URL: productionHost, VERCEL_URL: deploymentHost,
        });
        calls = [];
        assert.equal((await invoke()).status, 429, environment);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "https://" + expectedHost + "/.well-known/vercel/rate-limit-api/xiaoman-question");
        const headers = new Headers(calls[0].options.headers);
        assert.equal(headers.get("x-rr-host"), expectedHost);
        const bucket = headers.get("x-vercel-rate-limit-key");
        assert.match(bucket, /^xiaoman-anonymous:[a-f0-9]{64}-[a-f0-9]{64}$/, "SDK appends its own hash to the visitor key");
        assert.equal(bucket.includes("203.0.113.7"), false);
        if (firstBucket) assert.equal(bucket, firstBucket); else firstBucket = bucket;
        assert.equal(headers.has("authorization"), false);
        assert.equal(headers.has("x-rr-authorization"), false);
        assert.equal(headers.has("cookie"), false);
        assert.equal(headers.has("x-rr-cookie"), false);
        assert.equal(headers.has("x-rr-x-forwarded-host"), false);
        assert.equal(JSON.stringify([...headers]).includes(fixture.token), false);
        assert.equal(JSON.stringify([...headers]).includes(fixture.providerKey), false);
      }
      calls = [];
      assert.equal((await invoke("203.0.113.7", assistant, url.replace("/question", "/assistant"), fixture.assistantBody)).status, 429);
      assert.equal(new Headers(calls[0].options.headers).get("x-vercel-rate-limit-key"), firstBucket, "both routes share one visitor bucket");
      calls = [];
      assert.equal((await invoke("203.0.113.8")).status, 429);
      assert.notEqual(new Headers(calls[0].options.headers).get("x-vercel-rate-limit-key"), firstBucket, "different visitors do not share a global bucket");
      const ipv6Keys = [];
      for (const ip of ["2001:db8::1", "2001:0db8:0:0:0:0:0:1"]) {
        calls = [];
        assert.equal((await invoke(ip)).status, 429);
        ipv6Keys.push(new Headers(calls[0].options.headers).get("x-vercel-rate-limit-key"));
      }
      assert.equal(ipv6Keys[0], ipv6Keys[1], "equivalent IPv6 spellings cannot produce separate buckets");
      for (const ip of ["", "not-an-ip", "203.0.113.7, 198.51.100.1", "203.0.113.7:443"]) {
        calls = [];
        assert.equal((await invoke(ip)).status, 503);
        assert.equal(calls.length, 0, "untrusted fallback forwarding headers never select a bucket");
      }
      for (const environment of ["production", "preview"]) {
        for (const invalidHost of [undefined, "", "https://example.com", "example.com/path", "example.com:443", "user@example.com", "example.com?x=1", "example.com#x", "localhost", "127.0.0.1", "bad_label.example", "-bad.example", "example.com\\n", "a".repeat(254)]) {
          Object.assign(process.env, {
            VERCEL_ENV: environment, VERCEL_PROJECT_PRODUCTION_URL: productionHost, VERCEL_URL: deploymentHost,
          });
          const variable = environment === "production" ? "VERCEL_PROJECT_PRODUCTION_URL" : "VERCEL_URL";
          if (invalidHost === undefined) delete process.env[variable];
          else process.env[variable] = invalidHost;
          calls = [];
          const blocked = await invoke();
          assert.equal(blocked.status, 503, environment + ": " + invalidHost);
          assert.deepEqual(await blocked.json(), { error: "unavailable" });
          assert.equal(calls.length, 0, "invalid host must not reach limiter or provider");
        }
      }
    `, pathToFileURL(entrypoint).href, JSON.stringify({ token: BETA_TOKEN, providerKey: PROVIDER_KEY, body: questionBody(), assistantBody: assistantBody() }), pathToFileURL(assistantEntrypoint).href], {
      cwd: projectDir, encoding: "utf8",
      env: { SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "production", AI_ALLOWED_ORIGINS: "https://molly-gith.github.io" },
    });
    assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
  } finally {
    assert.equal(dirname(outputDir), outputParent);
    await rm(outputDir, { recursive: true, force: true });
  }
});
