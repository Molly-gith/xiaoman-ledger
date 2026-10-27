-- Synthetic-only contract test; requires reviewed migration functions.
-- For a pre-deploy dry run: BEGIN; <migration SQL>; <this file without BEGIN>.
-- ROLLBACK removes functions (when included), fixtures, auth users and all writes.
-- No real account payload is selected. Every worker invocation has owner_filter.
begin;
set local statement_timeout = '30s';
create temporary table salary_test_results(label text primary key) on commit drop;
create function pg_temp.salary_assert(label text, actual boolean) returns void
language plpgsql security invoker as $$ begin
  if actual is distinct from true then raise exception 'TEST_FAILED: %',label; end if;
  insert into salary_test_results values(label);
end; $$;
create function pg_temp.salary_expect_error(label text, statement text, expected text) returns void
language plpgsql security invoker as $$ declare actual text; begin
  begin execute statement; exception when others then actual := sqlstate; end;
  perform pg_temp.salary_assert(label,actual=expected);
end; $$;

create temporary table salary_test_fixture(label text primary key, user_id uuid not null, payload jsonb not null) on commit drop;
with book as (
  select '{"profile":null,"activeCycleId":null,"cycles":[],"budgets":[],"transactions":[],"investmentAccounts":[],"investmentFlows":[],"marketValueSnapshots":[],"settings":{"monthlyBudget":15000,"savingsCurrent":0,"savingsGoal":100000},"salaryBudget":{"enabled":true,"periodMode":"salary_based","salaryDay":31,"expectedSalary":10000,"percentages":{"消费":70,"浪费":5,"投资":25},"periodOverride":null,"autoIncome":{"enabled":true,"startDate":"2026-01-31","lastProcessedMonth":null}}}'::jsonb as data
)
insert into salary_test_fixture select label,gen_random_uuid(),data || jsonb_build_object('app','xiaoman-ledger','version',4,'revision',1,'ledgerKind','personal','otherLedgers',jsonb_build_object('family',jsonb_set(data,'{salaryBudget}','null'::jsonb),'travel',jsonb_set(data,'{salaryBudget}','null'::jsonb)))
from book cross join (values('A'),('B'),('invalid')) labels(label);

do $$ declare b jsonb; result jsonb; repeat_result jsonb; manual jsonb; word text; begin
  select payload into b from salary_test_fixture where label='A';
  result := xiaoman_private.apply_recurring_salary(b,date '2026-03-31');
  perform pg_temp.salary_assert('missed months caught up and short February clipped',
    jsonb_array_length(result->'transactions')=3 and result#>>'{transactions,0,date}'='2026-03-31' and result#>>'{transactions,1,date}'='2026-02-28' and result#>>'{transactions,2,date}'='2026-01-31');
  perform pg_temp.salary_assert('salary fields and provenance match browser contract',
    result#>'{transactions,1}'='{"id":"salary-auto-2026-02","type":"income","amount":10000,"date":"2026-02-28","category":"收入","note":"工资（自动记录，请核对实际到账）","icon":"薪","source":"text","cycleId":null,"nature":null,"spendKind":null,"autoSalary":{"month":"2026-02","scheduledDate":"2026-02-28"}}'::jsonb);
  perform pg_temp.salary_assert('income and watermark advance together',result#>>'{salaryBudget,autoIncome,lastProcessedMonth}'='2026-03');
  perform pg_temp.salary_assert('pure transformation leaves revision to writer',result->'revision'=b->'revision');
  repeat_result := xiaoman_private.apply_recurring_salary(result,date '2026-03-31');
  perform pg_temp.salary_assert('same date retry changes nothing',repeat_result=result);
  repeat_result := xiaoman_private.apply_recurring_salary(jsonb_set(result,'{transactions}','[]'::jsonb),date '2026-03-31');
  perform pg_temp.salary_assert('deletion does not regenerate processed wages',repeat_result->'transactions'='[]'::jsonb);
  perform pg_temp.salary_assert('inactive ledgers untouched',result->'otherLedgers'=b->'otherLedgers');
  perform pg_temp.salary_assert('legacy budget without explicit opt-in unchanged',xiaoman_private.apply_recurring_salary(b #- '{salaryBudget,autoIncome}',date '2026-03-31')=b #- '{salaryBudget,autoIncome}');
  perform pg_temp.salary_assert('disabled opt-in unchanged',xiaoman_private.apply_recurring_salary(jsonb_set(b,'{salaryBudget,autoIncome,enabled}','false'),date '2026-03-31')=jsonb_set(b,'{salaryBudget,autoIncome,enabled}','false'));
  perform pg_temp.salary_assert('disabled budget unchanged',xiaoman_private.apply_recurring_salary(jsonb_set(b,'{salaryBudget,enabled}','false'),date '2026-03-31')=jsonb_set(b,'{salaryBudget,enabled}','false'));
  perform pg_temp.salary_assert('before first payday leaves zero income',xiaoman_private.apply_recurring_salary(b,date '2026-01-30')->'transactions'='[]'::jsonb);
  repeat_result := jsonb_set(jsonb_set(b,'{salaryBudget,salaryDay}','10'),'{salaryBudget,autoIncome,startDate}','"2026-01-20"');
  repeat_result := xiaoman_private.apply_recurring_salary(repeat_result,date '2026-01-20');
  perform pg_temp.salary_assert('pre-activation payday skipped and watermark advanced',repeat_result->'transactions'='[]'::jsonb and repeat_result#>>'{salaryBudget,autoIncome,lastProcessedMonth}'='2026-01');
  repeat_result := xiaoman_private.apply_recurring_salary(jsonb_set(repeat_result,'{salaryBudget,salaryDay}','25'),date '2026-01-25');
  perform pg_temp.salary_assert('changing payday cannot backfill deliberately skipped month',repeat_result->'transactions'='[]'::jsonb);
  repeat_result := xiaoman_private.apply_recurring_salary(jsonb_set(b,'{salaryBudget,autoIncome,startDate}','"2026-02-01"'),date '2026-02-28');
  perform pg_temp.salary_assert('enable starts today and never creates previous salary',jsonb_array_length(repeat_result->'transactions')=1 and repeat_result#>>'{transactions,0,date}'='2026-02-28');
  repeat_result := xiaoman_private.apply_recurring_salary(jsonb_set(b,'{salaryBudget,autoIncome,startDate}','"2024-02-01"'),date '2024-02-29');
  perform pg_temp.salary_assert('leap February clipped to day 29',repeat_result#>>'{transactions,0,date}'='2024-02-29');
  repeat_result := xiaoman_private.apply_recurring_salary(jsonb_set(b,'{salaryBudget,periodOverride}','{"startDate":"2026-01-31","endDate":"2026-02-27","salary":1}'),date '2026-01-31');
  perform pg_temp.salary_assert('budget override never changes automatic income',repeat_result#>'{transactions,0,amount}'='10000'::jsonb);
  manual := '{"id":"manual","type":"income","amount":9000,"date":"2026-01-10","category":"收入","note":"工资","icon":"收","source":"text","cycleId":null,"nature":null,"spendKind":null}'::jsonb;
  repeat_result := xiaoman_private.apply_recurring_salary(jsonb_set(b,'{transactions}',jsonb_build_array(manual)),date '2026-01-31');
  perform pg_temp.salary_assert('explicit manual salary prevents duplicate regardless of amount',jsonb_array_length(repeat_result->'transactions')=1 and repeat_result#>>'{salaryBudget,autoIncome,lastProcessedMonth}'='2026-01');
  foreach word in array array['不是工资','并非薪资','不算薪水','非薪酬','工资卡转入','薪资账户转账','转账','salaryman','mypayroll'] loop
    perform pg_temp.salary_assert('manual non-salary exclusion: ' || word,not xiaoman_private.is_manual_salary(jsonb_set(manual,'{note}',to_jsonb(word)),date '2026-01-01'));
  end loop;
  foreach word in array array['工资','薪资','薪水','薪酬','ＳＡＬＡＲＹ','PAYROLL','paycheck','本月salary收入'] loop
    perform pg_temp.salary_assert('explicit salary vocabulary: ' || word,xiaoman_private.is_manual_salary(jsonb_set(manual,'{note}',to_jsonb(word)),date '2026-01-01'));
  end loop;
  perform pg_temp.salary_assert('expense is never manual salary',not xiaoman_private.is_manual_salary(jsonb_set(manual,'{type}','"expense"'),date '2026-01-01'));
  perform pg_temp.salary_assert('old timestamp overlap conservatively prevents duplicate',xiaoman_private.is_manual_salary(jsonb_set(manual,'{date}','"2025-12-31T10:00:00Z"'),date '2026-01-01'));
  perform pg_temp.salary_assert('old timestamp before overlap is not this month',not xiaoman_private.is_manual_salary(jsonb_set(manual,'{date}','"2025-12-31T09:59:59Z"'),date '2026-01-01'));
  perform pg_temp.salary_assert('old timestamp upper boundary excluded',not xiaoman_private.is_manual_salary(jsonb_set(manual,'{date}','"2026-02-01T12:00:00Z"'),date '2026-01-01'));
  perform pg_temp.salary_assert('timestamp without seconds is supported',xiaoman_private.is_manual_salary(jsonb_set(manual,'{date}','"2026-01-10T12:30+08:00"'),date '2026-01-01'));
  perform pg_temp.salary_assert('manual salary in another month does not suppress this month',not xiaoman_private.is_manual_salary(jsonb_set(manual,'{date}','"2026-02-10"'),date '2026-01-01'));
  repeat_result := xiaoman_private.apply_recurring_salary(jsonb_set(b,'{transactions}',jsonb_build_array(jsonb_set(manual,'{note}','"普通收入"'),jsonb_set(jsonb_set(manual,'{id}','"same-day-second"'),'{note}','"另一笔收入"'))),date '2026-01-31');
  perform pg_temp.salary_assert('new salary sorted first and existing same-day order stable',repeat_result#>>'{transactions,0,id}'='salary-auto-2026-01' and repeat_result#>>'{transactions,1,id}'='manual' and repeat_result#>>'{transactions,2,id}'='same-day-second');
  manual := jsonb_set(manual,'{autoSalary}','{"month":"2025-12","scheduledDate":"2025-12-31"}');
  perform pg_temp.salary_assert('moved automatic salary never becomes manual salary',not xiaoman_private.is_manual_salary(manual,date '2026-01-01'));
  repeat_result := jsonb_set(b,'{transactions}',jsonb_build_array(jsonb_set(manual,'{id}','"salary-auto-2026-01"')));
  repeat_result := xiaoman_private.apply_recurring_salary(repeat_result,date '2026-01-31');
  perform pg_temp.salary_assert('deterministic existing ID prevents duplicate',jsonb_array_length(repeat_result->'transactions')=1);
  repeat_result := jsonb_set(b,'{otherLedgers,family,salaryBudget}',b->'salaryBudget');
  repeat_result := xiaoman_private.apply_recurring_salary(repeat_result,date '2026-01-31');
  perform pg_temp.salary_assert('enabled inactive book gets independent salary',jsonb_array_length(repeat_result->'transactions')=1 and jsonb_array_length(repeat_result#>'{otherLedgers,family,transactions}')=1 and repeat_result#>'{otherLedgers,travel,transactions}'='[]'::jsonb);
end $$;

select pg_temp.salary_expect_error('capacity aborts whole catch-up', $$select xiaoman_private.apply_recurring_salary(jsonb_set((select payload from salary_test_fixture where label='A'),'{transactions}',(select jsonb_agg(jsonb_build_object('id','expense-'||i,'type','expense','date','2026-01-01','amount',1,'category','餐饮','note','')) from generate_series(1,4999)i)),date '2026-02-28')$$,'54000');
select pg_temp.salary_expect_error('invalid date rejected', $$select xiaoman_private.salary_iso_date('2026-02-30')$$,'22008');
select pg_temp.salary_expect_error('invalid day rejected', $$select xiaoman_private.apply_recurring_salary(jsonb_set((select payload from salary_test_fixture where label='A'),'{salaryBudget,salaryDay}','32'),date '2026-01-31')$$,'22023');
select pg_temp.salary_expect_error('fractional cents rejected', $$select xiaoman_private.apply_recurring_salary(jsonb_set((select payload from salary_test_fixture where label='A'),'{salaryBudget,expectedSalary}','10.001'),date '2026-01-31')$$,'22023');
select pg_temp.salary_expect_error('legacy unzoned salary timestamp fails closed', $$select xiaoman_private.is_manual_salary('{"type":"income","date":"2026-01-10T12:30","category":"收入","note":"工资"}'::jsonb,date '2026-01-01')$$,'22023');
select pg_temp.salary_expect_error('malformed active book identity rejected', $$select xiaoman_private.apply_recurring_salary((select payload from salary_test_fixture where label='A')-'ledgerKind',date '2026-01-31')$$,'22023');

-- Only these generated fixture UUIDs are inserted/read/processed below.
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
select user_id,'xiaoman-salary-sql-' || user_id::text || '@example.invalid','{}','{}' from salary_test_fixture;
insert into public.xiaoman_user_resources(user_id,resource,revision,payload)
select user_id,'ledger',1,case when label='invalid' then jsonb_set(payload,'{salaryBudget,salaryDay}','32') else payload end from salary_test_fixture;
do $$ declare result jsonb; snapshot_a jsonb; begin
  result := xiaoman_private.process_recurring_salaries(date '2026-01-31',array[(select user_id from salary_test_fixture where label='A'),(select user_id from salary_test_fixture where label='invalid')]);
  perform pg_temp.salary_assert('worker isolates malformed fixture and reports only counts',result='{"checked":2,"changed":1,"failed":1}'::jsonb);
  select payload into snapshot_a from public.xiaoman_user_resources where user_id=(select user_id from salary_test_fixture where label='A') and resource='ledger';
  perform pg_temp.salary_assert('worker atomically updates payload and resource revision',snapshot_a->>'revision'='2' and (select revision=2 from public.xiaoman_user_resources where user_id=(select user_id from salary_test_fixture where label='A') and resource='ledger'));
  perform pg_temp.salary_assert('non-target fixture B untouched', (select revision=1 and payload=(select payload from salary_test_fixture where label='B') from public.xiaoman_user_resources where user_id=(select user_id from salary_test_fixture where label='B') and resource='ledger'));
  perform pg_temp.salary_assert('failed fixture unchanged',(select revision=1 from public.xiaoman_user_resources where user_id=(select user_id from salary_test_fixture where label='invalid') and resource='ledger'));
  result := xiaoman_private.process_recurring_salaries(date '2026-01-31',array[(select user_id from salary_test_fixture where label='A')]);
  perform pg_temp.salary_assert('worker rerun changes no revision',result='{"checked":1,"changed":0,"failed":0}'::jsonb and (select payload=snapshot_a from public.xiaoman_user_resources where user_id=(select user_id from salary_test_fixture where label='A') and resource='ledger'));
end $$;

grant select on salary_test_fixture to authenticated;
grant select,insert on salary_test_results to authenticated;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub',(select user_id::text from salary_test_fixture where label='A'),true);
end $$;
select pg_temp.salary_expect_error('stale browser write cannot erase scheduled salary',$$select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','ledger','expected_revision',1,'payload',jsonb_set(payload,'{revision}','2'))) from salary_test_fixture where label='A'))$$,'40001');
reset role;
select pg_temp.salary_assert('anonymous role cannot call private worker',not has_function_privilege('anon','xiaoman_private.process_recurring_salaries(date,uuid[])','EXECUTE'));
select pg_temp.salary_assert('authenticated role cannot call private worker',not has_function_privilege('authenticated','xiaoman_private.process_recurring_salaries(date,uuid[])','EXECUTE'));
select pg_temp.salary_assert('no private schema usage for browser roles',not has_schema_privilege('authenticated','xiaoman_private','USAGE') and not has_schema_privilege('anon','xiaoman_private','USAGE'));
select count(*) as passed_synthetic_salary_assertions from salary_test_results;
rollback;
