import {defaultState} from '../lib/data/schema.ts';
import {buildCompanionContext} from '../lib/domain/companion-context.ts';
export const COMPANION_TEST_TODAY='2026-10-27';
export const COMPANION_PREFS={tone:'playful',remindersEnabled:true,dailyExpenseTarget:null,lunchReference:null,mutedUntil:null};
export const companionDraft=(patch={})=>({type:'expense',amount:28,category:'餐饮',occurred_at:COMPANION_TEST_TODAY,note:'奶茶',nature_suggestion:'消费',confidence:0.9,ambiguous:false,...patch});
export const companionOutput=(patch={})=>({intent:'companion',transactions:[],query:null,preference:null,answer:'听起来你需要喘口气。真喜欢就认真享受，选择还是你的。',clarification:'',confidence:0.9,referenced_facts:[],...patch});
export function companionRequest(text='今天累，就是想喝',prefs={},records=[]) {
 const state=defaultState();state.transactions=records;
 const companion=buildCompanionContext(state,COMPANION_TEST_TODAY,{...COMPANION_PREFS,...prefs});
 return {protocolVersion:2,text,context:{today:COMPANION_TEST_TODAY,timezone:'Asia/Hong_Kong'},ledgerKind:'personal',
  defaultRange:companion.range,memory:{recentMessages:[]},companion};
}
export const savedExpense=(amount=28,patch={})=>({id:'synthetic-expense',type:'expense',amount,date:COMPANION_TEST_TODAY,category:'餐饮',note:'仅虚拟测试奶茶',
 nature:'消费',spendKind:'variable',cycleId:null,source:'text',icon:'餐',...patch});
export function buildCompanionCases() {
 const build=(id,body,referenceOutput,status='answer')=>({id,input:{operation:'assistLedgerCompanion',payload:(( {protocolVersion,context,...p})=>{void protocolVersion;void context;return p;})(body),context:body.context},request:body,referenceOutput,expected:{status}});
 return [
  build('companion-01',companionRequest('今天奶茶28元'),companionOutput({intent:'transactions',transactions:[companionDraft()],answer:''}),'transactions'),
  build('companion-02',{...companionRequest(),memory:{recentMessages:[{role:'user',content:'奶茶已经在网页保存了，我有点纠结值不值。'},{role:'assistant',content:'喜欢与否由你决定，预算是参考。'}]}},companionOutput()),
  build('companion-03',companionRequest('昨天午饭'),companionOutput({intent:'clarification',answer:'',clarification:'午饭花了多少钱？'}),'clarification'),
  build('companion-04',companionRequest('今天花费给我提个醒',{},[savedExpense(46.8)]),companionOutput({answer:'[[fact:day_expense_fen]]。下一笔先停一下，分清是喜欢还是顺手。',referenced_facts:['day_expense_fen']})),
  build('companion-05',companionRequest('这杯是不是两顿午饭的钱？',{},[savedExpense()]),companionOutput({answer:'我还不知道你的午餐参考价，先不替你比饭钱。它值不值，可以从你喜不喜欢来想。'})),
  build('companion-06',companionRequest('今天花费大概相当于多少午饭钱？',{lunchReference:14},[savedExpense()]),companionOutput({answer:'[[fact:day_lunch_equivalent_hundredths]]。这只是换个角度看金额，喜欢与否还是你决定。',referenced_facts:['day_lunch_equivalent_hundredths']})),
  build('companion-07',companionRequest('直接一点，别开玩笑',{tone:'plain'}),companionOutput({answer:'可以，接下来我会直说。你可以继续聊当前的选择，不必先补充账目。'})),
  build('companion-08',companionRequest('今天只想聊聊，别劝我省钱',{remindersEnabled:false}),companionOutput({answer:'好，今天先不聊省钱。有什么想说的，我听着。'})),
  build('companion-09',companionRequest('咖啡19元，不是浪费'),companionOutput({intent:'transactions',transactions:[companionDraft({amount:19,note:'咖啡',nature_suggestion:'消费'})],answer:''}),'transactions'),
  build('companion-10',companionRequest('从我另一张卡转来2000元'),companionOutput({intent:'question',answer:'自己账户之间的资金移动不是新增收支，当前不能单独记录转账。'})),
  build('companion-11',companionRequest('上个月餐饮花多少'),companionOutput({intent:'query',answer:'',query:{range:{startDate:'2026-09-01',endDate:'2026-09-30'},type:'expense',categories:['餐饮'],metric:'total'}}),'query'),
  build('companion-12',companionRequest('记住，以后健身课算投资'),companionOutput({intent:'preference',answer:'',preference:{keyword:'健身课',category:null,nature:'投资'}}),'preference'),
 ];
}
