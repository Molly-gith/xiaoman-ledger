import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/classify.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { classifyTransaction } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const cases = [
  ["指甲油37.8", "购物"],
  ["买了一个台灯 89", "购物"],
  ["小米手机 2999", "购物"],
  ["米面粮油 120", "餐饮"],
  ["食用油 45", "餐饮"],
  ["车厘子 32", "餐饮"],
  ["地铁 5", "交通"],
  ["汽车加油 300", "交通"],
  ["房租 3500", "居住"],
  ["药店买药 48", "健康"],
];

test("classifies common Chinese expense descriptions without single-character false positives", () => {
  for (const [description, expected] of cases) {
    assert.equal(classifyTransaction(description, "expense").category, expected, description);
  }
});

test("income and unknown descriptions keep predictable fallbacks", () => {
  assert.equal(classifyTransaction("工资到账 8000", "income").category, "收入");
  assert.equal(classifyTransaction("临时事项 20", "expense").category, "其他");
});

