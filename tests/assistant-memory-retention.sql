-- Synthetic rollback suite only. Never reads or updates resources outside generated UUIDs.
begin;
set local statement_timeout = '30s';
create temporary table retention_results(label text primary key) on commit drop;
create function pg_temp.retention_assert(label text,actual boolean) returns void language plpgsql as $$ begin
  if actual is distinct from true then raise exception 'TEST_FAILED: %',label; end if;
  insert into retention_results values(label);
end; $$;
create function pg_temp.retention_error(label text,statement text,expected text) returns void language plpgsql as $$ declare code text; begin
  begin execute statement; exception when others then code:=sqlstate; end;
  perform pg_temp.retention_assert(label,code=expected);
end; $$;
create function pg_temp.iso(t timestamptz) returns text language sql stable as $$ select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
create function pg_temp.msg(id text,t timestamptz,extra jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
 select jsonb_build_object('id',id,'role','assistant','content','synthetic text '||id,'createdAt',pg_temp.iso(t)) || extra $$;
create temporary table retention_fixture(label text primary key,owner_id uuid,payload jsonb,ledger jsonb,run_at timestamptz) on commit drop;
insert into retention_fixture
select label,gen_random_uuid(),jsonb_build_object('version',2,'conversation',jsonb_build_array(
 pg_temp.msg('expired',date_trunc('milliseconds',statement_timestamp())-interval '2160 hours'+interval '1 hour','{"clarification":{"originalText":"synthetic old original","question":"synthetic question"}}'::jsonb),
 pg_temp.msg('receipt',statement_timestamp(),'{"replyTo":"expired"}'::jsonb),
 pg_temp.msg('new',statement_timestamp(),'{"replyTo":"receipt","reminderId":"personal:today:near"}'::jsonb)),
 'preferences','[{"id":"pref","keyword":"奶茶","category":"餐饮","nature":"消费"}]'::jsonb,
 'clarification','{"originalText":"synthetic old original","question":"synthetic question"}'::jsonb,
 'companion','{"tone":"playful","remindersEnabled":true,"dailyExpenseTarget":0,"lunchReference":14,"mutedUntil":null}'::jsonb),
 '{"app":"xiaoman-ledger","version":4,"revision":1,"ledgerKind":"personal","profile":null,"activeCycleId":null,"cycles":[],"budgets":[],"transactions":[],"investmentAccounts":[],"investmentFlows":[],"marketValueSnapshots":[],"settings":{},"otherLedgers":{}}'::jsonb,
 date_trunc('milliseconds',statement_timestamp()) + interval '2 hours'
from (values('A'),('B')) labels(label);
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
 select owner_id,'xiaoman-retention-'||owner_id::text||'@example.invalid','{}','{}' from retention_fixture;
grant select on retention_fixture to authenticated,anon;
grant select,insert on retention_results to authenticated,anon;

-- Pure transform: strict millisecond boundary, all content attached to expired rows removed.
create temporary table retention_pure as
select payload || jsonb_build_object('conversation',jsonb_build_array(
 pg_temp.msg('before',t-interval '2160 hours'-interval '1 millisecond','{"clarification":{"originalText":"old sensitive original","question":"old"}}'::jsonb),
 pg_temp.msg('equal',t-interval '2160 hours','{"replyTo":"before"}'::jsonb),
 pg_temp.msg('after',t-interval '2160 hours'+interval '1 millisecond','{"replyTo":"equal"}'::jsonb),
 pg_temp.msg('orphan',t,'{"replyTo":"missing"}'::jsonb))) as input,t
from retention_fixture cross join (select timestamptz '2030-04-01T00:00:00.123Z' t) time_value where label='A';
alter table retention_pure add column actual jsonb;
update retention_pure set actual=xiaoman_private.prune_memory_payload(input,t);
select pg_temp.retention_assert('strict boundary keeps equal and after, drops before',(select jsonb_array_length(actual->'conversation')=3 and actual#>>'{conversation,0,id}'='equal' and actual#>>'{conversation,1,id}'='after' from retention_pure));
select pg_temp.retention_assert('expired content and embedded original removed',(select actual::text not like '%old sensitive original%' and actual::text not like '%synthetic text before%' from retention_pure));
select pg_temp.retention_assert('orphan links removed, valid links retained',(select not (actual#>'{conversation,0}' ? 'replyTo') and actual#>>'{conversation,1,replyTo}'='equal' and not (actual#>'{conversation,2}' ? 'replyTo') from retention_pure));
select pg_temp.retention_assert('expiry clears unaged clarification',(select actual->'clarification'='null'::jsonb from retention_pure));
select pg_temp.retention_assert('preferences companion and version unchanged',(select actual-array['conversation','clarification']=input-array['conversation','clarification'] from retention_pure));
select pg_temp.retention_assert('retained message body unchanged except orphan link',(select actual#>'{conversation,0}'=(input#>'{conversation,1}')-'replyTo' and actual#>'{conversation,1}'=input#>'{conversation,2}' from retention_pure));
select pg_temp.retention_assert('prune is idempotent',(select xiaoman_private.prune_memory_payload(actual,t)=actual from retention_pure));
select pg_temp.retention_assert('submillisecond run time uses millisecond cutoff',(select xiaoman_private.prune_memory_payload(input,t+interval '0.9 milliseconds')=actual from retention_pure));
select pg_temp.retention_assert('all expired messages leave empty history and unchanged preferences',(select xiaoman_private.prune_memory_payload(input,t+interval '2161 hours')->'conversation'='[]'::jsonb and xiaoman_private.prune_memory_payload(input,t+interval '2161 hours')->'preferences'=input->'preferences' from retention_pure));
select pg_temp.retention_assert('legacy v1 shape remains legacy after pruning',(select xiaoman_private.prune_memory_payload(input-array['version','companion'],t)=actual-array['version','companion'] from retention_pure));
select pg_temp.retention_assert('future timestamp is retained rather than deleted',(select xiaoman_private.prune_memory_payload(jsonb_set(input,'{conversation}',jsonb_build_array(pg_temp.msg('future',t+interval '1 year'))),t)#>>'{conversation,0,id}'='future' from retention_pure));
select pg_temp.retention_assert('orphan-only cleanup preserves unexpired clarification',(select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,1,replyTo}','"missing"'),statement_timestamp())->'clarification'=payload->'clarification' and not(xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,1,replyTo}','"missing"'),statement_timestamp())#>'{conversation,1}'?'replyTo') from retention_fixture where label='A'));
set local timezone = 'America/New_York';
select pg_temp.retention_assert('90 times 24 hours unaffected by server timezone or DST',(select xiaoman_private.prune_memory_payload(input,t)=actual from retention_pure));
set local timezone = 'UTC';
select pg_temp.retention_assert('no expiry preserves clarification exactly',(select xiaoman_private.prune_memory_payload(payload,statement_timestamp())=payload from retention_fixture where label='A'));
select pg_temp.retention_error('invalid timestamp rejected without guessing deletion',$$select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,0,createdAt}','"not-a-date"'),run_at) from retention_fixture where label='A'$$,'22023');
select pg_temp.retention_error('noncanonical timestamp rejected',$$select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,0,createdAt}','"2026-10-27T00:00:00+00:00"'),run_at) from retention_fixture where label='A'$$,'22023');
select pg_temp.retention_error('invalid calendar timestamp rejected',$$select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,0,createdAt}','"2026-02-30T00:00:00.000Z"'),run_at) from retention_fixture where label='A'$$,'22023');
select pg_temp.retention_error('null run time rejected',$$select xiaoman_private.prune_memory_payload(payload,null) from retention_fixture where label='A'$$,'22023');

-- Source-bound clarification retention, including already orphaned legacy payloads.
select pg_temp.retention_assert('empty conversation cannot retain unaged original text',(select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation}','[]'),statement_timestamp())->'clarification'='null'::jsonb from retention_fixture where label='A'));
select pg_temp.retention_assert('unbound clarification clears even without expired messages',(select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,0}',(payload#>'{conversation,0}')-'clarification'),statement_timestamp())->'clarification'='null'::jsonb from retention_fixture where label='A'));
select pg_temp.retention_assert('user message cannot anchor assistant clarification',(select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,0,role}','"user"'),statement_timestamp())->'clarification'='null'::jsonb from retention_fixture where label='A'));
select pg_temp.retention_assert('question mismatch cannot anchor old original text',(select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,0,clarification,question}','"different"'),statement_timestamp())->'clarification'='null'::jsonb from retention_fixture where label='A'));
select pg_temp.retention_assert('original text mismatch cannot anchor top clarification',(select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,0,clarification,originalText}','"different"'),statement_timestamp())->'clarification'='null'::jsonb from retention_fixture where label='A'));
select pg_temp.retention_assert('extra clarification fields cannot anchor top object',(select xiaoman_private.prune_memory_payload(jsonb_set(jsonb_set(payload,'{clarification}',payload->'clarification'||'{"extra":"raw"}'),'{conversation,0,clarification}',payload->'clarification'||'{"extra":"raw"}'),statement_timestamp())->'clarification'='null'::jsonb from retention_fixture where label='A'));
select pg_temp.retention_assert('valid source retains clarification when unrelated old message expires',(select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,1,clarification}',payload->'clarification'),run_at)->'clarification'=payload->'clarification' from retention_fixture where label='A'));
select pg_temp.retention_assert('source at exact cutoff remains valid',(select xiaoman_private.prune_memory_payload(jsonb_set(payload,'{conversation,0,createdAt}',to_jsonb(pg_temp.iso(run_at-interval '2160 hours'))),run_at)->'clarification'=payload->'clarification' from retention_fixture where label='A'));
select pg_temp.retention_assert('expired source clears clarification despite recent messages',(select xiaoman_private.prune_memory_payload(payload,run_at)->'clarification'='null'::jsonb and jsonb_array_length(xiaoman_private.prune_memory_payload(payload,run_at)->'conversation')=2 from retention_fixture where label='A'));

-- Authenticated callers can use ordinary writes; no access to private helper or worker.
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',(select owner_id::text from retention_fixture where label='A'),true); end $$;
select pg_temp.retention_assert('ordinary browser writes keep future-within-window payload',(select count(*)=1 and bool_and(payload=(select payload from retention_fixture where label='A')) from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',0,'payload',payload)) from retention_fixture where label='A'))));
select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_family','expected_revision',0,'payload',payload),jsonb_build_object('resource','memory_travel','expected_revision',0,'payload',payload),jsonb_build_object('resource','ledger','expected_revision',0,'payload',ledger)) from retention_fixture where label='A'));
select pg_temp.retention_error('authenticated cannot invoke worker',$$select xiaoman_private.process_memory_retention()$$,'42501');
select pg_temp.retention_error('authenticated cannot invoke helper',$$select xiaoman_private.prune_memory_payload('{}',now())$$,'42501');
do $$ begin perform set_config('request.jwt.claim.sub',(select owner_id::text from retention_fixture where label='B'),true); end $$;
select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',0,'payload',payload)) from retention_fixture where label='B'));
select pg_temp.retention_assert('account B cannot read A memory',(select count(*)=1 from public.xiaoman_read_resources(auth.uid())));
reset role;
create temporary table retention_job_result as select xiaoman_private.process_memory_retention((select run_at from retention_fixture where label='A'),array[(select owner_id from retention_fixture where label='A')]) result;
select pg_temp.retention_assert('worker touches only three scoped memories',(select result='{"checked":3,"changed":3,"deletedMessages":3,"failed":0}'::jsonb from retention_job_result));
select pg_temp.retention_assert('all three memories have CAS revision increment',(select count(*)=3 and bool_and(revision=2 and jsonb_array_length(payload->'conversation')=2 and payload->'clarification'='null'::jsonb) from public.xiaoman_user_resources where user_id=(select owner_id from retention_fixture where label='A') and resource like 'memory_%'));
select pg_temp.retention_assert('worker result equals pure transformation',(select bool_and(r.payload=xiaoman_private.prune_memory_payload(f.payload,f.run_at)) from public.xiaoman_user_resources r join retention_fixture f on f.owner_id=r.user_id where f.label='A' and r.resource like 'memory_%'));
select pg_temp.retention_assert('ledger payload and revision unchanged',(select r.revision=1 and r.payload=f.ledger from public.xiaoman_user_resources r join retention_fixture f on f.owner_id=r.user_id where f.label='A' and r.resource='ledger'));
select pg_temp.retention_assert('unselected account unchanged',(select r.revision=1 and r.payload=f.payload from public.xiaoman_user_resources r join retention_fixture f on f.owner_id=r.user_id where f.label='B' and r.resource='memory_personal'));
select pg_temp.retention_assert('worker idempotent',(select xiaoman_private.process_memory_retention(run_at,array[owner_id])='{"checked":3,"changed":0,"deletedMessages":0,"failed":0}'::jsonb from retention_fixture where label='A'));
select pg_temp.retention_assert('empty owner filter touches no rows',xiaoman_private.process_memory_retention(now(),array[]::uuid[])='{"checked":0,"changed":0,"deletedMessages":0,"failed":0}'::jsonb);

set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',(select owner_id::text from retention_fixture where label='A'),true); end $$;
select pg_temp.retention_error('old page CAS cannot restore removed content',$$select * from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',1,'payload',payload)) from retention_fixture where label='A'))$$,'40001');
-- Even a client with the current revision cannot write an actually expired message back.
select pg_temp.retention_assert('write trigger strips expiry even with current revision',(select count(*)=1 and bool_and(revision=3 and jsonb_array_length(payload->'conversation')=2 and payload->'clarification'='null'::jsonb and not(payload#>'{conversation,0}'?'replyTo')) from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_personal','expected_revision',2,'payload',jsonb_set(payload,'{conversation,0,createdAt}',to_jsonb(pg_temp.iso(statement_timestamp()-interval '2160 hours'-interval '1 second'))))) from retention_fixture where label='A'))));
select pg_temp.retention_assert('write trigger preserves preferences and companion',(select r.payload->'preferences'=f.payload->'preferences' and r.payload->'companion'=f.payload->'companion' from public.xiaoman_user_resources r join retention_fixture f on f.owner_id=r.user_id where f.label='A' and r.resource='memory_personal'));
select pg_temp.retention_error('direct table write cannot restore with stale revision',$$update public.xiaoman_user_resources set revision=3,payload=(select payload from retention_fixture where label='A') where user_id=auth.uid() and resource='memory_personal'$$,'40001');
select pg_temp.retention_error('direct malformed timestamp write rejects atomically',$$update public.xiaoman_user_resources set revision=4,payload=jsonb_set(payload,'{conversation,0,createdAt}','"bad"') where user_id=auth.uid() and resource='memory_personal'$$,'22023');
select pg_temp.retention_assert('failed writes preserve new payload revision',(select revision=3 and jsonb_array_length(payload->'conversation')=2 from public.xiaoman_read_resources(auth.uid(),array['memory_personal'])));
set local role anon;
select pg_temp.retention_error('anonymous caller cannot invoke worker',$$select xiaoman_private.process_memory_retention()$$,'42501');
reset role;
select pg_temp.retention_assert('browser trigger and private helper produce identical full payload',(select r.payload=xiaoman_private.prune_memory_payload(jsonb_set(f.payload,'{conversation,0,createdAt}',to_jsonb(pg_temp.iso(statement_timestamp()-interval '2160 hours'-interval '1 second'))),statement_timestamp()) from public.xiaoman_user_resources r join retention_fixture f on r.user_id=f.owner_id where f.label='A' and r.resource='memory_personal'));
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',(select owner_id::text from retention_fixture where label='B'),true); end $$;
select pg_temp.retention_assert('write trigger removes unbound clarification from empty old backup',(select count(*)=1 and bool_and(payload->'clarification'='null'::jsonb and payload->'conversation'='[]'::jsonb and payload->'preferences'=(select payload->'preferences' from retention_fixture where label='B')) from public.xiaoman_write_resources(auth.uid(),(select jsonb_build_array(jsonb_build_object('resource','memory_family','expected_revision',0,'payload',jsonb_set(payload,'{conversation}','[]'))) from retention_fixture where label='B'))));
reset role;
select pg_temp.retention_assert('private worker is invoker and browser execution revoked',(select not prosecdef and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') from pg_proc where oid='xiaoman_private.process_memory_retention(timestamptz,uuid[])'::regprocedure));
select pg_temp.retention_assert('retention trigger is invoker and browser execution revoked',(select not prosecdef and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') from pg_proc where oid='public.xiaoman_memory_retention_guard()'::regprocedure));
select pg_temp.retention_assert('account read RPC remains invoker and stable',(select not prosecdef and provolatile='s' from pg_proc where oid='public.xiaoman_read_resources(uuid,text[])'::regprocedure));
select pg_temp.retention_assert('resource table RLS remains enabled',(select relrowsecurity from pg_class where oid='public.xiaoman_user_resources'::regclass));
select count(*) as passed_memory_retention_assertions from retention_results;
rollback;
