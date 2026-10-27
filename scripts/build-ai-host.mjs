import { mkdir, writeFile } from "node:fs/promises";
await mkdir("ai-host", { recursive: true });
await writeFile("ai-host/index.html", '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>小满 AI</title><p>小满 AI 接口。请从小满账本使用文字或语音记账。</p></html>');
