-- Chat retention only. No existing rows are processed and no Cron job is activated here.
-- Enable the named hourly worker separately after synthetic rollback verification.
-- Ledger resources, salary jobs, preferences, companion settings, RLS and write CAS are unchanged.
create or replace function xiaoman_private.prune_memory_payload(input_payload jsonb, run_at timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  cutoff timestamptz; message jsonb; raw_time text; parsed_time timestamptz;
  kept jsonb; retained_ids jsonb;
begin
  if run_at is null or not isfinite(run_at) or jsonb_typeof(input_payload) is distinct from 'object' or
     jsonb_typeof(input_payload->'conversation') is distinct from 'array' or not (input_payload ? 'clarification') then
    raise exception 'XIAOMAN_INVALID_MEMORY_RETENTION' using errcode = '22023';
  end if;
  -- Exactly 90 * 24 hours, at JavaScript millisecond precision; never calendar days/DST.
  cutoff := date_trunc('milliseconds',run_at) - interval '2160 hours';
  for message in select value from jsonb_array_elements(input_payload->'conversation') loop
    raw_time := message->>'createdAt';
    if jsonb_typeof(message) is distinct from 'object' or jsonb_typeof(message->'id') is distinct from 'string' or
       message->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' or jsonb_typeof(message->'createdAt') is distinct from 'string' or
       raw_time !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
      raise exception 'XIAOMAN_INVALID_MEMORY_TIMESTAMP' using errcode = '22023';
    end if;
    begin
      parsed_time := raw_time::timestamptz;
      if not isfinite(parsed_time) or to_char(parsed_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> raw_time then
        raise exception 'invalid timestamp';
      end if;
    exception when others then raise exception 'XIAOMAN_INVALID_MEMORY_TIMESTAMP' using errcode = '22023';
    end;
  end loop;
  select coalesce(jsonb_agg(m order by ord),'[]'::jsonb) into kept
    from jsonb_array_elements(input_payload->'conversation') with ordinality items(m,ord)
    where (m->>'createdAt')::timestamptz >= cutoff;
  select coalesce(jsonb_object_agg(m->>'id','true'::jsonb),'{}'::jsonb) into retained_ids
    from jsonb_array_elements(kept) m;
  -- A retained receipt may refer to an expired message. Keep the receipt, remove only its dead link.
  select coalesce(jsonb_agg(case when m ? 'replyTo' and not (retained_ids ? (m->>'replyTo'))
    then m - 'replyTo' else m end order by ord),'[]'::jsonb) into kept
    from jsonb_array_elements(kept) with ordinality items(m,ord);
  input_payload := jsonb_set(input_payload,'{conversation}',kept,false);
  -- The legacy top-level clarification has no own clock. Keep it only while a
  -- retained assistant message carries the identical, two-field source object.
  -- Empty/orphaned legacy backups cannot retain original text indefinitely.
  if input_payload->'clarification' <> 'null'::jsonb and not exists (
    select 1 from jsonb_array_elements(kept) m where m->>'role' = 'assistant'
      and jsonb_typeof(m->'clarification') = 'object'
      and m->'clarification' = input_payload->'clarification'
      and (m->'clarification') ?& array['originalText','question']
      and ((m->'clarification') - array['originalText','question']) = '{}'::jsonb
      and jsonb_typeof(m#>'{clarification,originalText}') = 'string'
      and jsonb_typeof(m#>'{clarification,question}') = 'string'
  ) then input_payload := jsonb_set(input_payload,'{clarification}','null'::jsonb,false); end if;
  return input_payload;
end;
$$;
revoke all on function xiaoman_private.prune_memory_payload(jsonb,timestamptz) from public,anon,authenticated;

-- The trigger is self-contained so browser writes need no private-schema/function privileges.
-- Its pure transformation is identical to prune_memory_payload and covered by parity assertions.
create or replace function public.xiaoman_memory_retention_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  input_payload jsonb; run_at timestamptz;
  cutoff timestamptz; message jsonb; raw_time text; parsed_time timestamptz;
  kept jsonb; retained_ids jsonb;
begin
  if new.resource not in ('memory_personal','memory_family','memory_travel') then return new; end if;
  input_payload := new.payload;
  run_at := statement_timestamp();
  if run_at is null or not isfinite(run_at) or jsonb_typeof(input_payload) is distinct from 'object' or
     jsonb_typeof(input_payload->'conversation') is distinct from 'array' or not (input_payload ? 'clarification') then
    raise exception 'XIAOMAN_INVALID_MEMORY_RETENTION' using errcode = '22023';
  end if;
  -- Exactly 90 * 24 hours, at JavaScript millisecond precision; never calendar days/DST.
  cutoff := date_trunc('milliseconds',run_at) - interval '2160 hours';
  for message in select value from jsonb_array_elements(input_payload->'conversation') loop
    raw_time := message->>'createdAt';
    if jsonb_typeof(message) is distinct from 'object' or jsonb_typeof(message->'id') is distinct from 'string' or
       message->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' or jsonb_typeof(message->'createdAt') is distinct from 'string' or
       raw_time !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
      raise exception 'XIAOMAN_INVALID_MEMORY_TIMESTAMP' using errcode = '22023';
    end if;
    begin
      parsed_time := raw_time::timestamptz;
      if not isfinite(parsed_time) or to_char(parsed_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> raw_time then
        raise exception 'invalid timestamp';
      end if;
    exception when others then raise exception 'XIAOMAN_INVALID_MEMORY_TIMESTAMP' using errcode = '22023';
    end;
  end loop;
  select coalesce(jsonb_agg(m order by ord),'[]'::jsonb) into kept
    from jsonb_array_elements(input_payload->'conversation') with ordinality items(m,ord)
    where (m->>'createdAt')::timestamptz >= cutoff;
  select coalesce(jsonb_object_agg(m->>'id','true'::jsonb),'{}'::jsonb) into retained_ids
    from jsonb_array_elements(kept) m;
  -- A retained receipt may refer to an expired message. Keep the receipt, remove only its dead link.
  select coalesce(jsonb_agg(case when m ? 'replyTo' and not (retained_ids ? (m->>'replyTo'))
    then m - 'replyTo' else m end order by ord),'[]'::jsonb) into kept
    from jsonb_array_elements(kept) with ordinality items(m,ord);
  input_payload := jsonb_set(input_payload,'{conversation}',kept,false);
  -- The legacy top-level clarification has no own clock. Keep it only while a
  -- retained assistant message carries the identical, two-field source object.
  -- Empty/orphaned legacy backups cannot retain original text indefinitely.
  if input_payload->'clarification' <> 'null'::jsonb and not exists (
    select 1 from jsonb_array_elements(kept) m where m->>'role' = 'assistant'
      and jsonb_typeof(m->'clarification') = 'object'
      and m->'clarification' = input_payload->'clarification'
      and (m->'clarification') ?& array['originalText','question']
      and ((m->'clarification') - array['originalText','question']) = '{}'::jsonb
      and jsonb_typeof(m#>'{clarification,originalText}') = 'string'
      and jsonb_typeof(m#>'{clarification,question}') = 'string'
  ) then input_payload := jsonb_set(input_payload,'{clarification}','null'::jsonb,false); end if;
  new.payload := input_payload;
  return new;
end;
$$;
revoke all on function public.xiaoman_memory_retention_guard() from public,anon,authenticated;
-- PostgreSQL fires same-event triggers alphabetically: validate the existing contract first.
create trigger xiaoman_z_memory_retention before insert or update on public.xiaoman_user_resources
  for each row when (new.resource in ('memory_personal','memory_family','memory_travel'))
  execute function public.xiaoman_memory_retention_guard();

-- Cron runs as postgres, never via a browser RPC or SECURITY DEFINER.
-- The private owner_filter permits tests restricted to generated synthetic UUIDs.
create or replace function xiaoman_private.process_memory_retention(
  run_at timestamptz default statement_timestamp(), owner_filter uuid[] default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare row_value record; next_payload jsonb; checked integer := 0; changed integer := 0;
  deleted_messages integer := 0; failed integer := 0; affected integer;
begin
  if run_at is null or not isfinite(run_at) then
    raise exception 'XIAOMAN_INVALID_MEMORY_RETENTION' using errcode = '22023';
  end if;
  for row_value in
    select r.user_id,r.resource,r.revision,r.payload from public.xiaoman_user_resources r
    where r.resource in ('memory_personal','memory_family','memory_travel')
      and (owner_filter is null or r.user_id = any(owner_filter))
    order by r.user_id,r.resource for update skip locked
  loop
    checked := checked + 1;
    begin
      next_payload := xiaoman_private.prune_memory_payload(row_value.payload,run_at);
      if next_payload is distinct from row_value.payload then
        update public.xiaoman_user_resources r set revision = row_value.revision+1,payload = next_payload
          where r.user_id = row_value.user_id and r.resource = row_value.resource and r.revision = row_value.revision;
        get diagnostics affected = row_count;
        if affected <> 1 then raise exception 'XIAOMAN_CONFLICT' using errcode = '40001'; end if;
        changed := changed + 1;
        deleted_messages := deleted_messages + jsonb_array_length(row_value.payload->'conversation') - jsonb_array_length(next_payload->'conversation');
      end if;
    exception when others then
      -- Preserve a malformed resource; let independent accounts continue. Never log original text or IDs.
      failed := failed + 1;
    end;
  end loop;
  if failed > 0 then raise warning 'XIAOMAN_MEMORY_RETENTION_FAILED: %',failed; end if;
  return jsonb_build_object('checked',checked,'changed',changed,'deletedMessages',deleted_messages,'failed',failed);
end;
$$;
revoke all on function xiaoman_private.process_memory_retention(timestamptz,uuid[]) from public,anon,authenticated;
