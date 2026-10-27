-- Retain legacy memory rows without rewriting them. New clients write explicit
-- v2 payloads; once upgraded, an old client cannot downgrade and trim history.
-- The existing 2 MB per-memory resource_size constraint remains in force.
create or replace function public.xiaoman_guard_resource()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare companion jsonb; amount_value numeric; field_name text; quiet_date text;
begin
  if (tg_op = 'INSERT' and new.revision <> 1) or
     (tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.resource <> old.resource or new.revision <> old.revision + 1)) then
    raise exception 'XIAOMAN_CONFLICT' using errcode = '40001';
  end if;
  if new.resource = 'ledger' then
    -- Unchanged ledger/CAS contract; salary settings and the Cron worker keep
    -- passing through the same revision-envelope and base shape validation.
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
    if tg_op = 'UPDATE' and old.payload->'version' = '2'::jsonb and new.payload->'version' is distinct from '2'::jsonb then
      raise exception 'XIAOMAN_MEMORY_CLIENT_OUTDATED' using errcode = '40001';
    end if;
    if jsonb_typeof(new.payload->'conversation') is distinct from 'array' or
       jsonb_typeof(new.payload->'preferences') is distinct from 'array' or
       not (new.payload ? 'clarification') or
       jsonb_typeof(new.payload->'clarification') not in ('object','null') then
      raise exception 'XIAOMAN_INVALID_PAYLOAD' using errcode = '22023';
    end if;
    if new.payload->'version' = '2'::jsonb then
      if not (new.payload ?& array['conversation','preferences','clarification','version','companion']) or
         (new.payload - array['conversation','preferences','clarification','version','companion']) <> '{}'::jsonb or
         jsonb_typeof(new.payload->'companion') is distinct from 'object' then
        raise exception 'XIAOMAN_INVALID_PAYLOAD' using errcode = '22023';
      end if;
      companion := new.payload->'companion';
      if not (companion ?& array['tone','remindersEnabled','dailyExpenseTarget','lunchReference','mutedUntil']) or
         (companion - array['tone','remindersEnabled','dailyExpenseTarget','lunchReference','mutedUntil']) <> '{}'::jsonb or
         not coalesce(companion->>'tone' in ('gentle','playful','plain'),false) or
         jsonb_typeof(companion->'remindersEnabled') is distinct from 'boolean' then
        raise exception 'XIAOMAN_INVALID_COMPANION' using errcode = '22023';
      end if;
      foreach field_name in array array['dailyExpenseTarget','lunchReference'] loop
        if companion->field_name <> 'null'::jsonb then
          if jsonb_typeof(companion->field_name) is distinct from 'number' then
            raise exception 'XIAOMAN_INVALID_COMPANION' using errcode = '22023';
          end if;
          amount_value := (companion->>field_name)::numeric;
          if amount_value < 0 or amount_value > 999999999999.99 or trunc(amount_value,2) <> amount_value or
             (field_name = 'lunchReference' and amount_value = 0) then
            raise exception 'XIAOMAN_INVALID_COMPANION' using errcode = '22023';
          end if;
        end if;
      end loop;
      if companion->'mutedUntil' <> 'null'::jsonb then
        quiet_date := companion->>'mutedUntil';
        if jsonb_typeof(companion->'mutedUntil') is distinct from 'string' or quiet_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'XIAOMAN_INVALID_COMPANION' using errcode = '22023';
        end if;
        begin
          if quiet_date::date < date '1900-01-01' or quiet_date::date > date '9998-12-31' or to_char(quiet_date::date,'YYYY-MM-DD') <> quiet_date then
            raise exception 'XIAOMAN_INVALID_COMPANION' using errcode = '22023';
          end if;
        exception when others then raise exception 'XIAOMAN_INVALID_COMPANION' using errcode = '22023';
        end;
      end if;
      if exists (select 1 from jsonb_array_elements(new.payload->'conversation') m where
        (m ? 'reminderId' and (m->>'role' is distinct from 'assistant' or jsonb_typeof(m->'reminderId') is distinct from 'string' or m->>'reminderId' !~ '^[A-Za-z0-9:_-]{1,200}$')) or
        (m ? 'replyTo' and (m->>'role' is distinct from 'assistant' or jsonb_typeof(m->'replyTo') is distinct from 'string' or m->>'replyTo' !~ '^[A-Za-z0-9_-]{1,100}$'))) then
        raise exception 'XIAOMAN_INVALID_PAYLOAD' using errcode = '22023';
      end if;
    else
      -- A never-upgraded client may keep using its existing v1 contract. The v2
      -- downgrade guard above prevents it from overwriting upgraded history.
      if (new.payload - array['conversation','preferences','clarification']) <> '{}'::jsonb or
         jsonb_array_length(new.payload->'conversation') > 40 then
        raise exception 'XIAOMAN_INVALID_PAYLOAD' using errcode = '22023';
      end if;
    end if;
    if jsonb_array_length(new.payload->'preferences') > 50 then
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
