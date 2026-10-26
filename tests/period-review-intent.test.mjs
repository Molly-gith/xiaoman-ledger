import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriodReview } from '../lib/domain/period-review-intent.ts';
import { resolveLedgerQuery, MAX_QUERY_DAYS } from '../lib/domain/ledger-query.ts';
const range=(startDate,endDate)=>({startDate,endDate});
const context={today:'2026-09-15',defaultRange:range('2026-09-01','2026-09-30'),ledgerKind:'personal'};
const review=(text,ctx=context)=>{const result=resolvePeriodReview(text,ctx);assert.equal(result.kind,'review',text+JSON.stringify(result));return result.plan;};
test('review uses the explicit calendar dates or selected range without a budget',()=>{
 assert.deepEqual(review('帮我复盘这个月').range,context.defaultRange);
 assert.deepEqual(review('复盘这段时间',{...context,defaultRange:range('2026-08-20','2026-09-10')}).range,range('2026-08-20','2026-09-10'));
 assert.deepEqual(review('复盘2026-08-20至2026-09-10').range,range('2026-08-20','2026-09-10'));
 assert.equal(review('复盘上个月家庭账本').ledgerKind,'family');
});
test('a new review drops old category nature and comparison filters but carries follow-up dates and ledger',()=>{
 const previousQuery={range:range('2026-08-01','2026-08-31'),ledgerKind:'family',type:'expense',metric:'breakdown',categories:['餐饮'],natures:['消费'],comparison:'previous_month',breakdownBy:'category'};
 assert.deepEqual(review('再复盘一下',{...context,previousQuery}),{range:previousQuery.range,ledgerKind:'family',type:'all',metric:'total'});
 assert.deepEqual(review('再复盘这段时间',{...context,previousQuery}).range,context.defaultRange);
 assert.deepEqual(previousQuery.categories,['餐饮']);
 assert.equal(review('帮我复盘这个月',{...context,previousQuery}).ledgerKind,'personal');
});
test('explicit narrower questions keep query semantics and mutation or ambiguous requests do not become full-book reviews',()=>{
 for(const text of ['复盘这个月餐饮支出','复盘这个月收入','复盘这个月有几笔','复盘这个月与前一个月比较']) assert.equal(resolvePeriodReview(text,context).kind,'query',text);
 for(const text of ['复盘并删除全部账目','复盘然后记一笔午饭35元','复盘2026-09-30至2026-09-01','复盘家庭账本和旅行账本']) assert.notEqual(resolvePeriodReview(text,context).kind,'review',text);
 assert.equal(resolvePeriodReview('午饭35',context).kind,'none');
});

test('review purchases and cancelled reviews reach the entry path through both local resolvers',()=>{
 const previousQuery={range:context.defaultRange,ledgerKind:'family',type:'expense',metric:'total',categories:['餐饮']};
 for(const text of ['今天买复盘课程200元','今天上复盘课200，算投资','花59元买了一本复盘书','参加复盘培训600元','再买一本复盘教材30元','不复盘，记午饭35元','不用复盘，记工资8000元','别复盘，午饭35元','不需要复盘，早餐18元']){
   for(const ctx of [context,{...context,previousQuery}]){
     assert.equal(resolvePeriodReview(text,ctx).kind,'none',text);
     assert.equal(resolveLedgerQuery(text,ctx).kind,'none','fallback: '+text);
   }
 }
 assert.equal(resolveLedgerQuery('上个月复盘课程花多少',context).kind,'clarification');
});
test('affirmative review combined with writing remains a clarification, never an entry or query',()=>{
 for(const text of ['复盘并删除全部账目','复盘并修改昨天午饭金额为20元','复盘并删除复盘课程这笔','复盘然后记一笔午饭35元']){
   assert.equal(resolvePeriodReview(text,context).kind,'clarification',text);
 }
});
test('chat review reports its limit without rejecting a valid selected range',()=>{
 const longContext={...context,defaultRange:range('2000-01-01','2026-10-26')};
 const expected={kind:'clarification',question:'聊天复盘最多支持3660天；更长范围请到账单选择日期后点复盘这段时间'};
 assert.deepEqual(resolvePeriodReview('复盘当前日期范围',longContext),expected);
 assert.deepEqual(resolvePeriodReview('再复盘这段时间',{...longContext,previousQuery:{range:context.defaultRange,ledgerKind:'family',type:'expense',metric:'breakdown',categories:['餐饮'],natures:['消费'],breakdownBy:'category'}}),expected);
 assert.deepEqual(resolvePeriodReview('复盘2000-01-01至2026-10-26',context),expected);
 assert.deepEqual(review('复盘这个月',longContext).range,context.defaultRange);
 const end=new Date(Date.UTC(2000,0,1)+(MAX_QUERY_DAYS-1)*86400000).toISOString().slice(0,10);
 assert.deepEqual(review('复盘当前日期范围',{...context,defaultRange:range('2000-01-01',end)}).range,range('2000-01-01',end));
 assert.match(resolvePeriodReview('复盘当前日期范围',{...context,defaultRange:range('2026-09-31','2026-10-26')}).question,/无效/);
});
