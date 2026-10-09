import { mkdir, writeFile } from "node:fs/promises";
await mkdir("ai-host", { recursive: true });
await writeFile("ai-host/index.html", '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>小满 AI</title><p>小满 AI 私人体验接口。请从小满账本提问。</p></html>');
