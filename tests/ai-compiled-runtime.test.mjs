import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const projectDir = fileURLToPath(new URL("../", import.meta.url));

test("compiled Vercel API loads from JavaScript-only output and fails closed without secrets", async () => {
  const outputParent = join(projectDir, ".vercel");
  await mkdir(outputParent, { recursive: true });
  const outputDir = await mkdtemp(join(outputParent, "ai-compiled-test-"));
  try {
    const config = ts.readConfigFile(join(projectDir, "tsconfig.json"), ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectDir);
    const program = ts.createProgram({
      rootNames: [join(projectDir, "api/ai/question.ts")],
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

    // A fresh process receives only non-secret test configuration. Source .ts files
    // are absent from this output tree, matching Vercel's compiled file layout.
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      const { default: api } = await import(process.argv[1]);
      const url = "https://api.example.test/api/ai/question";
      const origin = "https://molly-gith.github.io";
      assert.equal((await api.fetch(new Request(url, { method: "OPTIONS", headers: { Origin: origin } }))).status, 204);
      const response = await api.fetch(new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" }));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "not_configured" });
      assert.equal((await api.fetch(new Request(url, { method: "POST", headers: { Origin: "https://untrusted.example" } }))).status, 403);
    `, pathToFileURL(entrypoint).href], {
      cwd: projectDir, encoding: "utf8",
      env: { SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "production", AI_ALLOWED_ORIGINS: "https://molly-gith.github.io" },
    });
    assert.equal(run.status, 0, run.stderr || run.stdout || String(run.error));
  } finally {
    assert.equal(dirname(outputDir), outputParent);
    await rm(outputDir, { recursive: true, force: true });
  }
});
