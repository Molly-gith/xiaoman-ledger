/** Offline DSL/contract checks only; no network or model calls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {createHash} from 'node:crypto';
import {buildCompanionCases} from './companion-cases.mjs';
import {buildV2AssistantCases} from './v2-assistant-cases.mjs';
import {validateConversationOutput,conversationResult} from '../lib/ai/conversation-contract.ts';
const d=yaml.load(readFileSync('docs/dify/xiaoman-companion-v1.yml','utf8'));
// SHA-256 of the two deployed legacy LLM nodes exported before this milestone.
const originalHashes={"1789572759225":"e7573fdb299cf05bd5c61e6d9df624cfbab7e19844b1f8fe4fb8b3ab27cd22aa","1792855601575":"1e586b21bb3ae340818c1fed24857828054399e489f9f3c4fa006b2838c5abe3"};
const nodes=d.workflow.graph.nodes,edges=d.workflow.graph.edges;
assert.equal(nodes.length,8);assert.equal(edges.length,9);
for(const [id,hash] of Object.entries(originalHashes)) assert.equal(createHash('sha256').update(JSON.stringify(nodes.find(n=>n.id===id))).digest('hex'),hash,'existing LLM model/prompt/schema unchanged');
assert.deepEqual(d.workflow.environment_variables,[]);assert.deepEqual(d.workflow.conversation_variables,[]);
const llm=nodes.find(n=>n.id==='xiaoman-companion-llm');
assert.equal(llm.data.prompt_template[0].text,readFileSync('docs/dify/companion-system-prompt.txt','utf8'));
assert.deepEqual(llm.data.structured_output.schema,JSON.parse(readFileSync('docs/dify/companion-schema.json','utf8')));
assert.deepEqual(llm.data.model,nodes.find(n=>n.id===Object.keys(originalHashes)[0]).data.model);
function paths(id,seen=[]){assert(!seen.includes(id));const n=nodes.find(n=>n.id===id),next=edges.filter(e=>e.source===id);return !next.length?[[n]]:next.flatMap(e=>paths(e.target,[...seen,id]).map(p=>[n,...p]));}
const routes=paths(nodes.find(n=>n.data.type==='start').id);assert.equal(routes.length,3);
for(const path of routes){assert.equal(path.filter(n=>n.data.type==='llm').length,1);assert.equal(path.at(-1).data.type,'end');}
const cases=buildCompanionCases();
for(const c of cases){
 assert(validateConversationOutput(c.referenceOutput,c.request.context.today,c.request.companion),c.id);
 const result=conversationResult(c.referenceOutput,c.request,{modelVersion:'offline',workflowVersion:'offline'});assert.equal(result.status,c.expected.status,c.id);
 if(c.referenceOutput.intent==='companion')assert(!result.answer.includes('我听着。想买、想省'),'authored natural answers must not hit fallback: '+c.id);
}
const invalid=structuredClone(cases.slice(0,4));
invalid[0].referenceOutput.referenced_facts=['missing_fact'];
invalid[1].referenceOutput.answer='[[fact:lunch_reference_fen]]';invalid[1].referenceOutput.referenced_facts=['lunch_reference_fen'];
invalid[2].referenceOutput.transactions=[cases[0].referenceOutput.transactions[0]];
invalid[3].referenceOutput.referenced_facts=[];
const python=nodes.find(n=>n.data.type==='code').data.code;
const py='import json,sys\ndata=json.load(sys.stdin)\nscope={}\nexec(compile(data["code"],"companion-check","exec"),scope)\nres=[]\nfor c in data["cases"]:\n try:\n  out=scope["main"](c["referenceOutput"],c["input"]["operation"],json.dumps(c["input"]["payload"],ensure_ascii=False),json.dumps(c["input"]["context"]))\n  res.append(out["result_json"]==c["referenceOutput"])\n except Exception:\n  res.append(False)\nprint(json.dumps(res))';
const all=[...cases,...buildV2AssistantCases(),...invalid];
const run=spawnSync(process.platform==='win32'?'python':'python3',['-X','utf8','-c',py],{input:JSON.stringify({code:python,cases:all}),encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(run.status,0,run.stderr);const results=JSON.parse(run.stdout);
assert(results.slice(0,cases.length+27).every(Boolean),JSON.stringify(results));
assert(results.slice(-invalid.length).every(v=>!v));
console.log(JSON.stringify({exclusivePaths:routes.length,modelCallsPerPath:1,legacyModelPromptSchemaUnchanged:true,companionFixtures:cases.length,oldV2Fixtures:27,invalidRejected:invalid.length,liveCalls:0}));
