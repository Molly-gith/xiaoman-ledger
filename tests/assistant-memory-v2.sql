-- Synthetic-only memory v2 contract. Execute only against a disposable/local
-- database or an explicitly approved remote rollback transaction.
-- No account payloads outside the generated fixture UUIDs are read or changed.
begin;
set local statement_timeout = '30s';
create temporary table memory_test_results(label text primary key) on commit drop;
create function pg_temp.memory_assert(label text,actual boolean) returns void language plpgsql as $$ begin
  if actual is distinct from true then raise exception 'TEST_FAILED: %',label; end if;
  insert into memory_test_results values(label);
end; $$;
create function pg_temp.memory_expect_error(label text,statement text,expected text) returns void language plpgsql as $$ declare code text; begin
  begin execute statement; exception when others then code:=sqlstate; end;
  perform pg_temp.memory_assert(label,code=expected);
end; $$;

create temporary table memory_test_fixture(label text primary key,owner_id uuid not null,legacy jsonb not null,upgraded jsonb not null) on commit drop;
with legacy as (
  select jsonb_build_object('conversation',jsonb_agg(jsonb_build_object('id','m'||i,'role','user','content','历史消息'||i,'createdAt','2026-10-27T08:00:00.000Z') order by i),'preferences','[]'::jsonb,'clarification',null) as payload from generate_series(1,40)i
)
insert into memory_test_fixture select label,gen_random_uuid(),payload,payload || jsonb_build_object('version',2,'companion',jsonb_build_object('tone','gentle','remindersEnabled',false,'dailyExpenseTarget',80.25,'lunchReference',25.5,'mutedUntil','2026-11-01')) from legacy cross join(values('A'),('B'))labels(label);
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) select owner_id,'xiaoman-memory-v2-'||owner_id::text||'@example.invalid','{}','{}' from memory_test_fixture;
grant select on memory_test_fixture to authenticated,anon;
grant select,insert on memory_test_results to authenticated;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',(select owner_id::text from memory_test_fixture where label='A'),true); end $$;

select pg_temp.memory_assert('legacy v1 remains accepted without rewriting rows',(select count(*)=1 from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',0,'payload',legacy)) from memory_test_fixture where label='A'))));
select pg_temp.memory_assert('legacy content preserved exactly',(select payload=(select legacy from memory_test_fixture where label='A') from public.xiaoman_read_resources(auth.uid(),array['memory_personal'])));
select pg_temp.memory_assert('v1 to v2 upgrade preserves history and companion',(select count(*)=1 and bool_and(revision=2 and payload=(select upgraded from memory_test_fixture where label='A')) from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',1,'payload',upgraded)) from memory_test_fixture where label='A'))));
select pg_temp.memory_expect_error('old RPC client cannot downgrade or truncate upgraded history',$$select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',2,'payload',legacy)) from memory_test_fixture where label='A'))$$,'40001');
select pg_temp.memory_expect_error('direct table write cannot downgrade upgraded history',$$update public.xiaoman_user_resources set revision=3,payload=(select legacy from memory_test_fixture where label='A') where user_id=auth.uid() and resource='memory_personal'$$,'40001');
select pg_temp.memory_assert('failed downgrade preserved full payload and revision',(select revision=2 and payload=(select upgraded from memory_test_fixture where label='A') from public.xiaoman_read_resources(auth.uid(),array['memory_personal'])));

select pg_temp.memory_assert('v2 accepts more than forty messages without truncation',(select count(*)=1 and bool_and(revision=3 and jsonb_array_length(payload->'conversation')=120 and payload#>>'{conversation,0,id}'='m1') from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',2,'payload',jsonb_set(upgraded,'{conversation}',(select jsonb_agg(jsonb_build_object('id','m'||i,'role','user','content','历史消息'||i,'createdAt','2026-10-27T08:00:00.000Z') order by i) from generate_series(1,120)i)))) from memory_test_fixture where label='A'))));
select pg_temp.memory_expect_error('stale v2 writer conflicts',$$select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',2,'payload',upgraded)) from memory_test_fixture where label='A'))$$,'40001');

do $$ declare patch jsonb; begin
  for patch in select value from jsonb_array_elements('[{"tone":"other"},{"remindersEnabled":"yes"},{"dailyExpenseTarget":-1},{"dailyExpenseTarget":1.001},{"lunchReference":0},{"lunchReference":"25"},{"mutedUntil":"2026-02-30"},{"mutedUntil":"2026-10-27T00:00:00Z"},{"extra":true}]'::jsonb) loop
    perform pg_temp.memory_expect_error('invalid companion rejected: '||patch::text,format('select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object(''resource'',''memory_personal'',''expected_revision'',3,''payload'',jsonb_set(upgraded,''{companion}'',(upgraded->''companion'')||%L::jsonb))) from memory_test_fixture where label=''A''))',patch::text),'22023');
  end loop;
end $$;
select pg_temp.memory_expect_error('missing v2 companion rejected',$$select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',3,'payload',upgraded-'companion')) from memory_test_fixture where label='A'))$$,'22023');
select pg_temp.memory_expect_error('UTF8 payload above 2 MB rejects atomically',$$select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',3,'payload',jsonb_set(upgraded,'{conversation}',(select jsonb_agg(jsonb_build_object('id','large'||i,'role','user','content',repeat('字',2000),'createdAt','2026-10-27T08:00:00.000Z')) from generate_series(1,350)i)))) from memory_test_fixture where label='A'))$$,'23514');
select pg_temp.memory_assert('capacity failures preserve all old messages',(select revision=3 and jsonb_array_length(payload->'conversation')=120 from public.xiaoman_read_resources(auth.uid(),array['memory_personal'])));

select pg_temp.memory_assert('assistant reminder and reply links survive v2 save',(select count(*)=1 and bool_and(payload#>>'{conversation,0,reminderId}'='personal:budget:2026-10-01_2026-10-31') from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_family','expected_revision',0,'payload',jsonb_set(upgraded,'{conversation}','[{"id":"reminder","role":"assistant","content":"已用金额来自账目","createdAt":"2026-10-27T08:00:00.000Z","reminderId":"personal:budget:2026-10-01_2026-10-31","replyTo":"m1"}]'::jsonb))) from memory_test_fixture where label='A'))));
select pg_temp.memory_expect_error('user cannot pretend to be an assistant reminder',$$select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_family','expected_revision',1,'payload',jsonb_set(upgraded,'{conversation}','[{"id":"x","role":"user","content":"test","createdAt":"2026-10-27T08:00:00.000Z","reminderId":"test"}]'::jsonb))) from memory_test_fixture where label='A'))$$,'22023');
select pg_temp.memory_assert('explicit conversation clearing can keep companion configuration',(select count(*)=1 and bool_and(payload->'conversation'='[]'::jsonb and payload#>>'{companion,tone}'='gentle') from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',3,'payload',jsonb_set(upgraded,'{conversation}','[]'::jsonb))) from memory_test_fixture where label='A'))));

do $$ begin perform set_config('request.jwt.claim.sub',(select owner_id::text from memory_test_fixture where label='B'),true); end $$;
select pg_temp.memory_assert('account B cannot read account A memory',(select count(*)=0 from public.xiaoman_read_resources(auth.uid(),array['memory_personal','memory_family'])));
select pg_temp.memory_assert('account B can create its independent v2 memory',(select count(*)=1 and bool_and(revision=1) from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',0,'payload',upgraded)) from memory_test_fixture where label='B'))));
reset role;
select pg_temp.memory_assert('both accounts and books keep independent revisions',(select count(*)=3 and count(*) filter(where user_id=(select owner_id from memory_test_fixture where label='A') and resource='memory_personal' and revision=4)=1 from public.xiaoman_user_resources where user_id in(select owner_id from memory_test_fixture)));
select pg_temp.memory_assert('trigger remains invoker with no callable browser permissions',(select not prosecdef and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') from pg_proc where oid='public.xiaoman_guard_resource()'::regprocedure));
select count(*) as passed_memory_v2_assertions from memory_test_results;
rollback;
