-- Additive only: legacy tables and device-local ledgers are not migrated.
create table public.xiaoman_user_resources (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource text not null check (resource in ('ledger', 'memory_personal', 'memory_family', 'memory_travel')),
  revision bigint not null check (revision between 1 and 9007199254740990),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, resource),
  constraint resource_size check (octet_length(payload::text) <= case when resource = 'ledger' then 50000000 else 2000000 end)
);
alter table public.xiaoman_user_resources enable row level security;
create policy xiaoman_resources_select_own on public.xiaoman_user_resources
  for select to authenticated using ((select auth.uid()) = user_id);
create policy xiaoman_resources_insert_own on public.xiaoman_user_resources
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy xiaoman_resources_update_own on public.xiaoman_user_resources
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.xiaoman_user_resources from public, anon, authenticated;
grant select, insert, update on public.xiaoman_user_resources to authenticated;

-- Direct Data API writes receive the same version and shape checks as the RPC.
create function public.xiaoman_guard_resource()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.revision <> 1) or
     (tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.resource <> old.resource or new.revision <> old.revision + 1)) then
    raise exception 'XIAOMAN_CONFLICT' using errcode = '40001';
  end if;
  if new.resource = 'ledger' then
    if new.payload->>'app' is distinct from 'xiaoman-ledger' or
       new.payload->'version' is distinct from '4'::jsonb or
       new.payload->'revision' is distinct from to_jsonb(new.revision) or
       new.payload->>'ledgerKind' not in ('personal','family','travel') or
       not (new.payload ?& array['ledgerKind','profile','activeCycleId','cycles','budgets','transactions','investmentAccounts','investmentFlows','marketValueSnapshots','settings','otherLedgers']) or
       jsonb_typeof(new.payload->'transactions') is distinct from 'array' or
       jsonb_typeof(new.payload->'otherLedgers') is distinct from 'object' then
      raise exception 'XIAOMAN_INVALID_PAYLOAD' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(new.payload->'conversation') is distinct from 'array' or
       jsonb_typeof(new.payload->'preferences') is distinct from 'array' or
       not (new.payload ? 'clarification') or
       jsonb_typeof(new.payload->'clarification') not in ('object','null') or
       (new.payload - array['conversation','preferences','clarification']) <> '{}'::jsonb then
      raise exception 'XIAOMAN_INVALID_PAYLOAD' using errcode = '22023';
    end if;
    if jsonb_array_length(new.payload->'conversation') > 40 or jsonb_array_length(new.payload->'preferences') > 50 then
      raise exception 'XIAOMAN_INVALID_PAYLOAD' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(new.payload->'conversation') m where
      jsonb_typeof(m) is distinct from 'object' or not (m ?& array['id','role','content','createdAt']) or
      m->>'role' not in ('user','assistant') or jsonb_typeof(m->'content') is distinct from 'string' or
      length(m->>'content') not between 1 and 2000) then
      raise exception 'XIAOMAN_INVALID_PAYLOAD' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.xiaoman_guard_resource() from public, anon, authenticated;
create trigger xiaoman_resource_guard before insert or update on public.xiaoman_user_resources
  for each row execute function public.xiaoman_guard_resource();

-- expected_user_id is an additional stale-session guard, never authorization.
-- The signed JWT determines auth.uid(); callers cannot choose another owner.
create function public.xiaoman_read_resources(expected_user_id uuid,
  resources text[] default array['ledger','memory_personal','memory_family','memory_travel'])
returns table(resource text, revision bigint, payload jsonb)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or expected_user_id is distinct from auth.uid() then
    raise exception 'XIAOMAN_ACCOUNT_CHANGED' using errcode = '42501';
  end if;
  if resources is null or cardinality(resources) not between 1 and 4 or
     array_position(resources, null) is not null or
     not resources <@ array['ledger','memory_personal','memory_family','memory_travel']::text[] or
     (select count(distinct v) from unnest(resources) v) <> cardinality(resources) then
    raise exception 'XIAOMAN_INVALID_RESOURCES' using errcode = '22023';
  end if;
  return query select r.resource, r.revision, r.payload from public.xiaoman_user_resources r
    where r.user_id = auth.uid() and r.resource = any(resources) order by r.resource;
end;
$$;
revoke all on function public.xiaoman_read_resources(uuid, text[]) from public, anon;
grant execute on function public.xiaoman_read_resources(uuid, text[]) to authenticated;

create function public.xiaoman_write_resources(expected_user_id uuid, changes jsonb)
returns table(resource text, revision bigint, payload jsonb)
language plpgsql security invoker set search_path = '' as $$
declare
  change jsonb;
  resource_name text;
  expected bigint;
  affected integer;
begin
  if auth.uid() is null or expected_user_id is distinct from auth.uid() then
    raise exception 'XIAOMAN_ACCOUNT_CHANGED' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' then
    raise exception 'XIAOMAN_INVALID_CHANGES' using errcode = '22023';
  end if;
  if jsonb_array_length(changes) not between 1 and 4 or
     (select count(distinct item->>'resource') from jsonb_array_elements(changes) item) <> jsonb_array_length(changes) then
    raise exception 'XIAOMAN_INVALID_CHANGES' using errcode = '22023';
  end if;
  -- Stable lock order; failure rolls back the complete batch, including imports.
  for change in select item from jsonb_array_elements(changes) item order by item->>'resource' loop
    if jsonb_typeof(change) is distinct from 'object' or
       not (change ?& array['resource','expected_revision','payload']) or
       (change - array['resource','expected_revision','payload']) <> '{}'::jsonb or
       jsonb_typeof(change->'expected_revision') is distinct from 'number' or
       (change->>'expected_revision') !~ '^(0|[1-9][0-9]{0,15})$' or
       jsonb_typeof(change->'payload') is distinct from 'object' then
      raise exception 'XIAOMAN_INVALID_CHANGES' using errcode = '22023';
    end if;
    resource_name := change->>'resource';
    expected := (change->>'expected_revision')::bigint;
    if resource_name not in ('ledger','memory_personal','memory_family','memory_travel') or expected > 9007199254740989 then
      raise exception 'XIAOMAN_INVALID_CHANGES' using errcode = '22023';
    end if;
    if expected = 0 then
      insert into public.xiaoman_user_resources(user_id, resource, revision, payload)
        values (auth.uid(), resource_name, 1, change->'payload')
        on conflict on constraint xiaoman_user_resources_pkey do nothing;
    else
      update public.xiaoman_user_resources r set revision = expected + 1, payload = change->'payload'
        where r.user_id = auth.uid() and r.resource = resource_name and r.revision = expected;
    end if;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'XIAOMAN_CONFLICT' using errcode = '40001'; end if;
  end loop;
  return query select r.resource, r.revision, r.payload from public.xiaoman_user_resources r
    where r.user_id = auth.uid() and r.resource in (select item->>'resource' from jsonb_array_elements(changes) item)
    order by r.resource;
end;
$$;
revoke all on function public.xiaoman_write_resources(uuid, jsonb) from public, anon;
grant execute on function public.xiaoman_write_resources(uuid, jsonb) to authenticated;
