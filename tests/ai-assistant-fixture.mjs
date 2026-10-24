export const origin='https://molly-gith.github.io';
export const endpoint='https://assistant.example/api/ai/assistant';
export const environment={AI_ALLOWED_ORIGINS:origin,DIFY_API_KEY:'test-only-provider-key',DIFY_MODEL_VERSION:'test-model',DIFY_WORKFLOW_VERSION:'test-assistant-v1'};
export const context={today:'2026-10-24',timezone:'Asia/Hong_Kong'};
export const report={range:{startDate:'2026-10-01',endDate:'2026-10-31'},transactionCount:3,incomeCount:1,expenseCount:2,income:8000,expense:45,balance:7955,natureTotals:{消费:35,浪费:0,投资:10,未分类:0},pendingDateCount:0};
export const draft={type:'expense',amount:35,category:'餐饮',occurred_at:'2026-10-23',note:'午饭',nature_suggestion:'消费',confidence:0.9,ambiguous:false};
export const requestBody=()=>({text:'昨天午饭35元',context:{...context}});
export const workflow=(overrides={})=>({intent:'transactions',transactions:[{...draft}],answer:'',next_actions:[],referenced_facts:[],clarification:'',confidence:0.9,...overrides});
export const output=(overrides={})=>({status:'transactions',drafts:[{...draft}],modelVersion:environment.DIFY_MODEL_VERSION,workflowVersion:environment.DIFY_WORKFLOW_VERSION,...overrides});
export const upstream=value=>Response.json({data:{status:'succeeded',outputs:{result_json:JSON.stringify(value)}}});
export function request(body=requestBody(),options={}) {const {headers={},...other}=options;return new Request(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body),...other});}
