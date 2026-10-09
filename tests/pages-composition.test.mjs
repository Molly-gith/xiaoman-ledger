import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { composePreviewPages, QUESTION_API } from "../scripts/compose-preview-pages.mjs";

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), "xiaoman-pages-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const roots = ["main", "v6", "ai"].map(name => join(parent, name));
  const bases = ["/xiaoman-ledger/", "/xiaoman-ledger/previews/pr-23/", "/xiaoman-ledger/previews/pr-24/"];
  for (const [index, root] of roots.entries()) {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), `<script type="module" src="${bases[index]}assets/app.js"></script>`);
    await writeFile(join(root, "assets", "app.js"), index === 2 ? `const api=${JSON.stringify(QUESTION_API)};` : "const api='';");
    await writeFile(join(root, "manifest.webmanifest"), `manifest-${index}`);
  }
  return { roots, output: join(parent, "site") };
}

test("one Pages artifact retains stable root and PR23 while enabling only PR24", async t => {
  const { roots, output } = await fixture(t);
  await composePreviewPages(...roots, output);
  for (const [index, destination] of [output, join(output, "previews/pr-23"), join(output, "previews/pr-24")].entries()) {
    assert.equal(await readFile(join(destination, "index.html"), "utf8"), await readFile(join(roots[index], "index.html"), "utf8"));
    assert.equal(await readFile(join(destination, "manifest.webmanifest"), "utf8"), `manifest-${index}`);
    assert.equal((await readFile(join(destination, "assets/app.js"), "utf8")).includes(QUESTION_API), index === 2);
  }
});

test("wrong asset base cannot produce a partial site", async t => {
  const { roots, output } = await fixture(t);
  await writeFile(join(roots[1], "index.html"), '<script src="/xiaoman-ledger/assets/app.js"></script>');
  await assert.rejects(composePreviewPages(...roots, output), /wrong asset base/);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("a missing retained preview blocks creation of the entire artifact", async t => {
  const { roots, output } = await fixture(t);
  await assert.rejects(composePreviewPages(roots[0], join(roots[1], "missing"), roots[2], output), { code: "ENOENT" });
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("AI absent from PR24 or accidentally present in V6 blocks publication", async t => {
  const { roots, output } = await fixture(t);
  await writeFile(join(roots[2], "assets/app.js"), "const api='';");
  await assert.rejects(composePreviewPages(...roots, output), /Unexpected AI configuration/);
  await assert.rejects(stat(output), { code: "ENOENT" });
  await writeFile(join(roots[2], "assets/app.js"), QUESTION_API);
  await writeFile(join(roots[1], "assets/app.js"), QUESTION_API);
  await assert.rejects(composePreviewPages(...roots, output), /Unexpected AI configuration/);
  await assert.rejects(stat(output), { code: "ENOENT" });
});

test("an existing output is preserved rather than replaced", async t => {
  const { roots, output } = await fixture(t);
  await mkdir(output);
  await writeFile(join(output, "keep.txt"), "existing-site");
  await assert.rejects(composePreviewPages(...roots, output), { code: "EEXIST" });
  assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "existing-site");
});
