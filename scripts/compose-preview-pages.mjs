import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const QUESTION_API = "https://xiaoman-ai-beta.vercel.app/api/ai/question";

async function validateBuild(directory, base, aiEnabled) {
  const html = await readFile(join(directory, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
  if (!scripts.length || scripts.some(source => !source.startsWith(`${base}assets/`))) {
    throw new Error(`Build has the wrong asset base: ${base}`);
  }
  let containsApi = false;
  for (const entry of await readdir(join(directory, "assets"), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      containsApi ||= (await readFile(join(directory, "assets", entry.name), "utf8")).includes(QUESTION_API);
    }
  }
  if (containsApi !== aiEnabled) {
    throw new Error(`Unexpected AI configuration for ${base}`);
  }
  // A build must not smuggle in another preview or overwrite the composed paths.
  try {
    await stat(join(directory, "previews"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Build already contains previews: ${base}`);
}

export async function composePreviewPages(mainDir, v6Dir, previewDir, outputDir) {
  await Promise.all([
    validateBuild(mainDir, "/xiaoman-ledger/", false),
    validateBuild(v6Dir, "/xiaoman-ledger/previews/pr-23/", false),
    validateBuild(previewDir, "/xiaoman-ledger/previews/pr-24/", true),
  ]);
  // Never remove an existing directory. All three inputs must validate first.
  await mkdir(outputDir);
  for (const entry of await readdir(mainDir)) {
    await cp(join(mainDir, entry), join(outputDir, entry), { recursive: true, errorOnExist: true, force: false });
  }
  await mkdir(join(outputDir, "previews"));
  await cp(v6Dir, join(outputDir, "previews", "pr-23"), { recursive: true });
  await cp(previewDir, join(outputDir, "previews", "pr-24"), { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const inputs = process.argv.slice(2);
  if (inputs.length !== 4) throw new Error("Expected main, V6, PR24 and fresh output directories");
  await composePreviewPages(...inputs);
}
