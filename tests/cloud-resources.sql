-- Synthetic database contract test. Run only with authorized database access.
-- Everything, including auth users and temporary helper functions, is rolled back.
-- No API keys, real accounts, or existing ledger rows are selected or modified.
-- This covers stale-writer CAS and batch atomicity, not a two-session race test.
-- Reference: https://supabase.com/docs/guides/local-development/testing/overview
begin;
set local statement_timeout = '20s';

create temporary table xiaoman_test_users (label text primary key, id uuid not null, ledger jsonb not null, memory jsonb not null) on commit drop;
with base as (
  select '{"profile":null,"activeCycleId":null,"cycles":[],"budgets":[],"transactions":[],"investmentAccounts":[],"investmentFlows":[],"marketValueSnapshots":[],"settings":{"monthlyBudget":15000,"savingsCurrent":0,"savingsGoal":100000}}'::jsonb as payload
)
insert into xiaoman_test_users
select label, gen_random_uuid(), payload || jsonb_build_object('app','xiaoman-ledger','version',4,'revision',1,'ledgerKind','personal','otherLedgers',jsonb_build_object('family',payload,'travel',payload)),
  '{"conversation":[],"preferences":[],"clarification":null}'::jsonb
from base cross join (values ('A'),('B')) labels(label);
insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data)
select id, 'xiaoman-sql-' || id::text || '@example.invalid', '{}'::jsonb, '{}'::jsonb from xiaoman_test_users;
grant select on xiaoman_test_users to authenticated, anon;

create function pg_temp.assert_true(label text, actual boolean) returns void
language plpgsql security invoker as $$
begin
  if actual is distinct from true then raise exception 'TEST_FAILED: %', label; end if;
end;
$$;
create function pg_temp.expect_error(label text, statement text, expected text) returns void
language plpgsql security invoker as $$
declare actual text;
begin
  begin
    execute statement;
  exception when others then
    actual := sqlstate;
  end;
  if actual is distinct from expected then
    raise exception 'TEST_FAILED: % (expected SQLSTATE %, received %)', label, expected, coalesce(actual,'no error');
  end if;
end;
$$;

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', (select id::text from xiaoman_test_users where label='A'), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',(select id from xiaoman_test_users where label='A'),'role','authenticated')::text, true);
end $$;
select pg_temp.assert_true('A creates ledger and three separate memory resources in one RPC', (
  select count(*)=4 from public.xiaoman_write_resources(auth.uid(), (
    select jsonb_build_array(
      jsonb_build_object('resource','ledger','expected_revision',0,'payload',ledger),
      jsonb_build_object('resource','memory_personal','expected_revision',0,'payload',memory),
      jsonb_build_object('resource','memory_family','expected_revision',0,'payload',memory),
      jsonb_build_object('resource','memory_travel','expected_revision',0,'payload',memory)) from xiaoman_test_users where label='A'))));
select pg_temp.assert_true('filtered read contains only requested memory', (select count(*)=1 and bool_and(resource='memory_family') from public.xiaoman_read_resources(auth.uid(),array['memory_family'])));
select pg_temp.expect_error('duplicate read filters rejected', $$select * from public.xiaoman_read_resources(auth.uid(),array['ledger','ledger'])$$, '22023');
select pg_temp.expect_error('unknown read filters rejected', $$select * from public.xiaoman_read_resources(auth.uid(),array['profiles'])$$, '22023');
select pg_temp.expect_error('empty read filters rejected', $$select * from public.xiaoman_read_resources(auth.uid(),array[]::text[])$$, '22023');
select pg_temp.expect_error('null read filters rejected', $$select * from public.xiaoman_read_resources(auth.uid(),array[null]::text[])$$, '22023');
select pg_temp.expect_error('owner mismatch read rejected', $$select * from public.xiaoman_read_resources((select id from xiaoman_test_users where label='B'))$$, '42501');
select pg_temp.expect_error('owner mismatch write rejected', $$select * from public.xiaoman_write_resources((select id from xiaoman_test_users where label='B'), '[{"resource":"memory_personal","expected_revision":0,"payload":{"conversation":[],"preferences":[],"clarification":null}}]'::jsonb)$$, '42501');
select pg_temp.expect_error('duplicate create rejected', $$select * from public.xiaoman_write_resources(auth.uid(), '[{"resource":"memory_personal","expected_revision":0,"payload":{"conversation":[],"preferences":[],"clarification":null}}]'::jsonb)$$, '40001');
select pg_temp.assert_true('fresh CAS update succeeds', (select count(*)=1 and bool_and(revision=2) from public.xiaoman_write_resources(auth.uid(), '[{"resource":"memory_personal","expected_revision":1,"payload":{"conversation":[],"preferences":[],"clarification":null}}]'::jsonb)));
select pg_temp.expect_error('stale CAS update rejected', $$select * from public.xiaoman_write_resources(auth.uid(), '[{"resource":"memory_personal","expected_revision":1,"payload":{"conversation":[],"preferences":[],"clarification":null}}]'::jsonb)$$, '40001');
select pg_temp.expect_error('later resource conflict rejects full batch', $$select * from public.xiaoman_write_resources(auth.uid(), '[{"resource":"memory_family","expected_revision":1,"payload":{"conversation":[],"preferences":[],"clarification":null}},{"resource":"memory_travel","expected_revision":0,"payload":{"conversation":[],"preferences":[],"clarification":null}}]'::jsonb)$$, '40001');
select pg_temp.assert_true('earlier resource update rolled back', (select revision=1 from public.xiaoman_read_resources(auth.uid(),array['memory_family'])));
select pg_temp.expect_error('ledger update rolls back when later memory conflicts', $$select * from public.xiaoman_write_resources(auth.uid(), (select jsonb_build_array(jsonb_build_object('resource','ledger','expected_revision',1,'payload',jsonb_set(ledger,'{revision}','2')),jsonb_build_object('resource','memory_travel','expected_revision',0,'payload',memory)) from xiaoman_test_users where label='A'))$$, '40001');
select pg_temp.assert_true('ledger remains at original revision', (select revision=1 and payload->>'revision'='1' from public.xiaoman_read_resources(auth.uid(),array['ledger'])));

-- Direct Data API uses these table permissions: trigger checks cannot be skipped.
select pg_temp.expect_error('direct write cannot keep current revision', $$update public.xiaoman_user_resources set payload='{"conversation":[],"preferences":[],"clarification":null}'::jsonb where user_id=auth.uid() and resource='memory_personal'$$, '40001');
select pg_temp.expect_error('direct write cannot jump revisions', $$update public.xiaoman_user_resources set revision=4 where user_id=auth.uid() and resource='memory_personal'$$, '40001');
select pg_temp.expect_error('direct write cannot change owner', $$update public.xiaoman_user_resources set user_id=(select id from xiaoman_test_users where label='B'),revision=3 where user_id=auth.uid() and resource='memory_personal'$$, '40001');
select pg_temp.expect_error('direct write cannot change resource identity', $$update public.xiaoman_user_resources set resource='memory_other',revision=3 where user_id=auth.uid() and resource='memory_personal'$$, '40001');
select pg_temp.expect_error('direct write rejects malformed clarification', $$update public.xiaoman_user_resources set revision=3,payload='{"conversation":[],"preferences":[],"clarification":42}'::jsonb where user_id=auth.uid() and resource='memory_personal'$$, '22023');
select pg_temp.expect_error('direct write rejects system role', $$update public.xiaoman_user_resources set revision=3,payload='{"conversation":[{"id":"synthetic","role":"system","content":"not an allowed role","createdAt":"2026-10-25T02:00:00.000Z"}],"preferences":[],"clarification":null}'::jsonb where user_id=auth.uid() and resource='memory_personal'$$, '22023');
select pg_temp.expect_error('direct ledger write rejects envelope mismatch', $$update public.xiaoman_user_resources set revision=2 where user_id=auth.uid() and resource='ledger'$$, '22023');
select pg_temp.expect_error('authenticated delete is unavailable', $$delete from public.xiaoman_user_resources where user_id=auth.uid()$$, '42501');

do $$ begin
  perform set_config('request.jwt.claim.sub', (select id::text from xiaoman_test_users where label='B'), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',(select id from xiaoman_test_users where label='B'),'role','authenticated')::text, true);
end $$;
select pg_temp.assert_true('B cannot select A through direct table API', (select count(*)=0 from public.xiaoman_user_resources where user_id=(select id from xiaoman_test_users where label='A')));
select pg_temp.assert_true('B starts with zero own resources', (select count(*)=0 from public.xiaoman_read_resources(auth.uid())));
with changed as (update public.xiaoman_user_resources set revision=3 where user_id=(select id from xiaoman_test_users where label='A') and resource='memory_personal' returning 1)
select pg_temp.assert_true('B cannot update A through direct table API', (select count(*)=0 from changed));
select pg_temp.expect_error('B cannot insert under A ownership', $$insert into public.xiaoman_user_resources(user_id,resource,revision,payload) select id,'memory_family',1,memory from xiaoman_test_users where label='A'$$, '42501');
select pg_temp.assert_true('B creates its own resource independently', (select count(*)=1 and bool_and(revision=1) from public.xiaoman_write_resources(auth.uid(),'[{"resource":"memory_personal","expected_revision":0,"payload":{"conversation":[],"preferences":[],"clarification":null}}]'::jsonb)));

do $$ begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
end $$;
select pg_temp.expect_error('authenticated role without subject cannot read RPC', $$select * from public.xiaoman_read_resources((select id from xiaoman_test_users where label='A'))$$, '42501');
select pg_temp.assert_true('authenticated role without subject sees no fixture rows', (select count(*)=0 from public.xiaoman_user_resources where user_id in (select id from xiaoman_test_users)));

set local role anon;
select pg_temp.expect_error('anon cannot read RPC', $$select * from public.xiaoman_read_resources((select id from xiaoman_test_users where label='A'))$$, '42501');
select pg_temp.expect_error('anon cannot write RPC', $$select * from public.xiaoman_write_resources((select id from xiaoman_test_users where label='A'),'[]'::jsonb)$$, '42501');
select pg_temp.expect_error('anon cannot read table', $$select resource from public.xiaoman_user_resources where user_id=(select id from xiaoman_test_users where label='A')$$, '42501');
reset role;
select pg_temp.assert_true('final fixture state confirms no cross-account or failed-batch mutation', (
  select count(*)=5 and count(*) filter(where user_id=(select id from xiaoman_test_users where label='A') and resource='memory_personal' and revision=2)=1
    and count(*) filter(where user_id=(select id from xiaoman_test_users where label='A') and resource<>'memory_personal' and revision=1)=3
    and count(*) filter(where user_id=(select id from xiaoman_test_users where label='B') and resource='memory_personal' and revision=1)=1
  from public.xiaoman_user_resources where user_id in (select id from xiaoman_test_users)));
rollback;
select 'passed' as status, 'synthetic transaction rolled back; no real accounts or ledger data read' as cleanup;
