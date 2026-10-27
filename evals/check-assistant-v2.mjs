/**
 * Offline only. Parses DSL, checks mutually exclusive paths, runs its Python standard-library
 * validator against authored fixtures and rejects invalid outputs. No model/network calls.
 * Run from repository root: node --experimental-strip-types evals/check-assistant-v2.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { buildV2AssistantCases } from "./v2-assistant-cases.mjs";
import { validateQueryPlan } from "../lib/domain/ledger-query.ts";

{

const d=yaml.load(readFileSync('docs/dify/xiaoman-assistant-v2.yml','utf8'));
const original=yaml.load(readFileSync('docs/dify/xiaoman-assistant-v1.yml','utf8'));
const nodes=d.workflow.graph.nodes, edges=d.workflow.graph.edges;
assert.equal(nodes.length,7); assert.equal(edges.length,7);
assert.deepEqual(nodes.map(n=>n.data.type).sort(),['start','if-else','llm','llm','variable-aggregator','code','end'].sort());
assert.deepEqual(d.workflow.environment_variables,[]); assert.deepEqual(d.workflow.conversation_variables,[]);
const old=nodes.find(n=>n.id==='xiaoman-legacy-llm').data, baseline=original.workflow.graph.nodes.find(n=>n.data.type==='llm').data;
assert.deepEqual(old.prompt_template,baseline.prompt_template);
assert.deepEqual(old.structured_output,baseline.structured_output); assert.deepEqual(old.model,baseline.model);
assert.equal(nodes.find(n=>n.id==='xiaoman-v2-llm').data.prompt_template[0].text,readFileSync('docs/dify/assistant-v2-system-prompt.txt','utf8'));
const branch=nodes.find(n=>n.data.type==='if-else');
assert.equal(branch.data.cases[0].conditions[0].value,'assistLedgerV2');
const start=nodes.find(n=>n.data.type==='start');
function paths(id, seen=[]) { assert(!seen.includes(id),'no loop'); const node=nodes.find(n=>n.id===id), next=edges.filter(e=>e.source===id); return !next.length ? [[node]] : next.flatMap(e=>paths(e.target,[...seen,id]).map(path=>[node,...path])); }
assert.equal(paths(start.id).length,2);
for(const path of paths(start.id)) {assert.equal(path.filter(n=>n.data.type==='llm').length,1);assert.equal(path.at(-1).data.type,'end');}
const cases=buildV2AssistantCases(); assert.equal(cases.length,27);
for(const item of cases) if(item.referenceOutput.query) assert(validateQueryPlan(item.referenceOutput.query),item.id);
const python=nodes.find(n=>n.data.type==='code').data.code;
const program='import json,sys\ndata=json.load(sys.stdin)\nspace={}\nexec(compile(data["code"],"dify-output-check","exec"),space)\nresults=[]\nfor item in data["cases"]:\n try:\n  got=space["main"](item["referenceOutput"],item["input"]["operation"],json.dumps(item["input"]["payload"],ensure_ascii=False),json.dumps(item["input"]["context"]))\n  results.append({"id":item["id"],"passed":got["result_json"]==item["referenceOutput"]})\n except Exception as error:\n  results.append({"id":item["id"],"passed":False,"error":type(error).__name__})\nprint(json.dumps(results))';
const result=spawnSync(process.platform === 'win32' ? 'python' : 'python3',['-X','utf8','-c',program],{input:JSON.stringify({code:python,cases}),encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
const outcomes=JSON.parse(result.stdout);assert(outcomes.every(item=>item.passed),JSON.stringify(outcomes.filter(item=>!item.passed)));
process.stdout.write(JSON.stringify({nodes:nodes.length,exclusivePaths:2,llmCallsPerPath:1,legacyPromptAndSchemaUnchanged:true,referenceFixtures:outcomes.length,allFixturesPassed:true,modelCalls:0},null,2)+'\n');

}
{

const fixtures=buildV2AssistantCases(), clone=structuredClone;
const cases=[];
function invalid(id,base,mutate){const c=clone(fixtures.find(x=>x.id===base));c.id=id;mutate(c.referenceOutput);cases.push(c);}
invalid('extra-top','v2-05',o=>o.sql='SELECT *');
invalid('mixed-intent','v2-05',o=>o.answer='已查到100元');
invalid('missing-field','v2-05',o=>delete o.preference);
invalid('invalid-day','v2-05',o=>o.query.range.startDate='2026-02-30');
invalid('range-inverted','v2-05',o=>o.query.range.startDate='2026-11-01');
invalid('range-too-long','v2-05',o=>o.query.range={startDate:'1900-01-01',endDate:'9998-12-31'});
invalid('arbitrary-field','v2-05',o=>o.query.keyword='商家');
invalid('unknown-ledger','v2-05',o=>o.query.ledgerKind='all');
invalid('duplicate-category','v2-05',o=>o.query.categories=['餐饮','餐饮']);
invalid('income-expense-category','v2-05',o=>o.query.type='income');
invalid('expense-income-category','v2-05',o=>o.query.categories=['收入']);
invalid('nature-with-all','v2-11',o=>o.query.type='all');
invalid('group-on-total','v2-05',o=>o.query.breakdownBy='category');
invalid('partial-month-comparison','v2-12',o=>o.query.range.endDate='2026-10-24');
invalid('prior-outside-supported-years','v2-13',o=>o.query.range={startDate:'1900-01-01',endDate:'1900-01-07'});
invalid('preference-short','v2-17',o=>o.preference.keyword='咖');
invalid('preference-empty','v2-17',o=>{o.preference.category=null;o.preference.nature=null;});
invalid('preference-income','v2-17',o=>o.preference.category='收入');
invalid('transaction-future','v2-01',o=>o.transactions[0].occurred_at='2026-10-25');
invalid('transaction-fractional-cent','v2-01',o=>o.transactions[0].amount=1.005);
invalid('income-nature','v2-01',o=>o.transactions[0].nature_suggestion='消费');
invalid('ambiguous-draft','v2-01',o=>o.transactions[0].ambiguous=true);
invalid('confidence-above-one','v2-20',o=>o.confidence=1.1);
invalid('empty-question','v2-20',o=>o.answer=' ');
invalid('v2-output-on-old-operation','v2-05',()=>{});cases.at(-1).input.operation='assistLedger';
for(const item of cases) if(item.referenceOutput.query && !['extra-top','mixed-intent','missing-field','v2-output-on-old-operation'].includes(item.id)) assert(!validateQueryPlan(item.referenceOutput.query),item.id);
const d=yaml.load(readFileSync('docs/dify/xiaoman-assistant-v2.yml','utf8'));
const python=d.workflow.graph.nodes.find(n=>n.data.type==='code').data.code;
const program='import json,sys\ndata=json.load(sys.stdin)\nspace={}\nexec(compile(data["code"],"dify-output-check","exec"),space)\nresults=[]\nfor item in data["cases"]:\n try:\n  space["main"](item["referenceOutput"],item["input"]["operation"],json.dumps(item["input"]["payload"]),json.dumps(item["input"]["context"]))\n  results.append({"id":item["id"],"rejected":False})\n except Exception:\n  results.append({"id":item["id"],"rejected":True})\nprint(json.dumps(results))';
const r=spawnSync(process.platform === 'win32' ? 'python' : 'python3',['-X','utf8','-c',program],{input:JSON.stringify({code:python,cases}),encoding:'utf8'});
assert.equal(r.status,0,r.stderr);const outcomes=JSON.parse(r.stdout);assert(outcomes.every(x=>x.rejected),JSON.stringify(outcomes.filter(x=>!x.rejected)));
const defaultGroup=clone(fixtures.find(x=>x.id==='v2-10'));delete defaultGroup.referenceOutput.query.breakdownBy;assert(validateQueryPlan(defaultGroup.referenceOutput.query));
process.stdout.write(JSON.stringify({invalidOutputsRejected:outcomes.length,defaultBreakdownByAcceptedLocally:true,modelCalls:0})+'\n');

}

