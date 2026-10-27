-- Draft: apply only after review. This migration creates private functions only.
-- It does not install pg_cron, schedule a job, or process existing account rows.
create schema if not exists xiaoman_private;
revoke all on schema xiaoman_private from public, anon, authenticated;

create function xiaoman_private.salary_iso_date(value text)
returns date language plpgsql immutable strict security invoker set search_path = '' as $$
declare parsed date;
begin
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'XIAOMAN_INVALID_SALARY_DATE' using errcode = '22023';
  end if;
  parsed := value::date;
  if parsed < date '1900-01-01' or parsed > date '9998-12-31' or to_char(parsed,'YYYY-MM-DD') <> value then
    raise exception 'XIAOMAN_INVALID_SALARY_DATE' using errcode = '22023';
  end if;
  return parsed;
end;
$$;

-- Matches the TypeScript contract: explicit salary language only; no amount heuristic.
create function xiaoman_private.is_manual_salary(transaction_value jsonb, month_start date)
returns boolean language plpgsql immutable strict security invoker set search_path = '' as $$
declare words text; recorded text; instant timestamptz;
begin
  if transaction_value->>'type' is distinct from 'income' or
     coalesce(transaction_value->'autoSalary','null'::jsonb) <> 'null'::jsonb then return false; end if;
  words := lower(normalize(coalesce(transaction_value->>'category','') || ' ' || coalesce(transaction_value->>'note',''),NFKC));
  words := regexp_replace(words,'(不是|并非|不算|非)(工资|薪资|薪水|薪酬)','','g');
  words := regexp_replace(words,'(工资|薪资)(卡|账户)','','g');
  if words !~ '(工资|薪资|薪水|薪酬)|(^|[^a-z0-9_])(salary|payroll|paycheck)([^a-z0-9_]|$)' then return false; end if;
  recorded := transaction_value->>'date';
  if recorded ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return xiaoman_private.salary_iso_date(recorded) >= month_start and
      xiaoman_private.salary_iso_date(recorded) < (month_start + interval '1 month')::date;
  end if;
  -- Old timestamp rows may represent a date in any supported device time zone.
  -- Conservative overlap avoids a second salary while the date awaits confirmation.
  -- Explicit offsets are required for cloud scheduling. A legacy unzoned time
  -- has device-local semantics; fail closed rather than silently assume UTC.
  if recorded is null or recorded !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})$' then
    raise exception 'XIAOMAN_INVALID_SALARY_DATE' using errcode = '22023';
  end if;
  instant := recorded::timestamptz;
  return instant >= (month_start::timestamp at time zone 'UTC') - interval '14 hours' and
    instant < ((month_start + interval '1 month')::timestamp at time zone 'UTC') + interval '12 hours';
end;
$$;

create function xiaoman_private.apply_salary_to_book(book jsonb, run_date date)
returns jsonb language plpgsql immutable strict security invoker set search_path = '' as $$
declare
  settings jsonb := book->'salaryBudget';
  automation jsonb;
  entries jsonb := book->'transactions';
  start_date date;
  month_start date;
  last_month text;
  salary_day integer;
  salary numeric;
  due_date date;
  month_key text;
  already_recorded boolean;
  original_count integer;
  updated_book jsonb := book;
begin
  if settings->'enabled' is distinct from 'true'::jsonb or
     settings#>'{autoIncome,enabled}' is distinct from 'true'::jsonb then return book; end if;
  if run_date < date '1900-01-01' or run_date > date '9998-12-31' or
     jsonb_typeof(book) is distinct from 'object' or jsonb_typeof(entries) is distinct from 'array' or
     jsonb_array_length(entries) > 5000 then
    raise exception 'XIAOMAN_INVALID_SALARY_BOOK' using errcode = '22023';
  end if;
  automation := settings->'autoIncome';
  original_count := jsonb_array_length(entries);
  if (select count(distinct entry->>'id') from jsonb_array_elements(entries) entry) <> original_count then
    raise exception 'XIAOMAN_DUPLICATE_SALARY_IDS' using errcode = '22023';
  end if;
  if jsonb_typeof(automation) is distinct from 'object' or
     not (automation ?& array['enabled','startDate','lastProcessedMonth']) or
     (automation - array['enabled','startDate','lastProcessedMonth']) <> '{}'::jsonb or
     jsonb_typeof(automation->'startDate') is distinct from 'string' or
     jsonb_typeof(settings->'salaryDay') is distinct from 'number' or
     (settings->>'salaryDay') !~ '^[0-9]{1,2}$' or
     jsonb_typeof(settings->'expectedSalary') is distinct from 'number' then
    raise exception 'XIAOMAN_INVALID_SALARY_SETTINGS' using errcode = '22023';
  end if;
  salary_day := (settings->>'salaryDay')::integer;
  salary := (settings->>'expectedSalary')::numeric;
  if salary_day not between 1 and 31 or salary <= 0 or salary > 999999999999.99 or trunc(salary,2) <> salary then
    raise exception 'XIAOMAN_INVALID_SALARY_SETTINGS' using errcode = '22023';
  end if;
  start_date := xiaoman_private.salary_iso_date(automation->>'startDate');
  last_month := automation->>'lastProcessedMonth';
  if automation->'lastProcessedMonth' <> 'null'::jsonb and
     (jsonb_typeof(automation->'lastProcessedMonth') is distinct from 'string' or last_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then
    raise exception 'XIAOMAN_INVALID_SALARY_WATERMARK' using errcode = '22023';
  end if;
  month_start := make_date(extract(year from start_date)::integer,extract(month from start_date)::integer,1);
  if last_month is not null then
    month_start := greatest(month_start,(xiaoman_private.salary_iso_date(last_month || '-01') + interval '1 month')::date);
  end if;
  while month_start <= run_date loop
    due_date := month_start + (least(salary_day,extract(day from month_start + interval '1 month - 1 day')::integer)-1);
    exit when due_date > run_date;
    month_key := to_char(month_start,'YYYY-MM');
    if due_date >= start_date then
      select exists(select 1 from jsonb_array_elements(entries) entry where
        entry->>'id' = 'salary-auto-' || month_key or entry#>>'{autoSalary,month}' = month_key) into already_recorded;
      if not already_recorded then
        select exists(select 1 from jsonb_array_elements(entries) entry where
          xiaoman_private.is_manual_salary(entry,month_start)) into already_recorded;
      end if;
      if not already_recorded then
        if jsonb_array_length(entries) >= 5000 then
          -- Abort the entire transformation. No partial income or watermark can commit.
          raise exception 'XIAOMAN_SALARY_CAPACITY' using errcode = '54000';
        end if;
        entries := entries || jsonb_build_array(jsonb_build_object(
          'id','salary-auto-' || month_key,'type','income','amount',salary,'date',to_char(due_date,'YYYY-MM-DD'),
          'category','收入','note','工资（自动记录，请核对实际到账）','icon','薪','source','text',
          'cycleId',null,'nature',null,'spendKind',null,
          'autoSalary',jsonb_build_object('month',month_key,'scheduledDate',to_char(due_date,'YYYY-MM-DD'))));
      end if;
    end if;
    -- Remember skipped pre-activation paydays too; changing the configured day
    -- later must not backfill a month the user deliberately did not enable.
    last_month := month_key;
    month_start := (month_start + interval '1 month')::date;
  end loop;
  if last_month is distinct from automation->>'lastProcessedMonth' then
    if jsonb_array_length(entries) > original_count then
      select jsonb_agg(entry order by (entry->>'date') collate "C" desc, position)
        into entries from jsonb_array_elements(entries) with ordinality items(entry,position);
    end if;
    updated_book := jsonb_set(updated_book,'{salaryBudget,autoIncome,lastProcessedMonth}',to_jsonb(last_month),false);
    updated_book := jsonb_set(updated_book,'{transactions}',entries,false);
  end if;
  return updated_book;
end;
$$;

create function xiaoman_private.apply_recurring_salary(payload jsonb, run_date date)
returns jsonb language plpgsql immutable strict security invoker set search_path = '' as $$
declare result jsonb := payload; kind text;
begin
  if payload->>'app' is distinct from 'xiaoman-ledger' or payload->'version' is distinct from '4'::jsonb or
     not coalesce(payload->>'ledgerKind' in ('personal','family','travel'),false) or
     jsonb_typeof(payload->'otherLedgers') is distinct from 'object' or
     (select count(*) from jsonb_object_keys(payload->'otherLedgers')) <> 2 then
    raise exception 'XIAOMAN_INVALID_SALARY_LEDGER' using errcode = '22023';
  end if;
  result := xiaoman_private.apply_salary_to_book(result,run_date);
  foreach kind in array array['personal','family','travel'] loop
    if kind <> payload->>'ledgerKind' then
      if jsonb_typeof(result#>array['otherLedgers',kind]) is distinct from 'object' then
        raise exception 'XIAOMAN_INVALID_SALARY_LEDGER' using errcode = '22023';
      end if;
      result := jsonb_set(result,array['otherLedgers',kind],xiaoman_private.apply_salary_to_book(result#>array['otherLedgers',kind],run_date),false);
    end if;
  end loop;
  return result;
end;
$$;

-- The scheduler connects as postgres; no SECURITY DEFINER or browser-callable RPC.
-- owner_filter is private and exists to restrict rollback tests to synthetic users.
create function xiaoman_private.process_recurring_salaries(
  run_date date default (statement_timestamp() at time zone 'Asia/Hong_Kong')::date,
  owner_filter uuid[] default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare row_value record; updated_payload jsonb; checked integer := 0; changed integer := 0; failed integer := 0; affected integer;
begin
  if run_date is null or run_date < date '1900-01-01' or run_date > date '9998-12-31' then
    raise exception 'XIAOMAN_INVALID_SALARY_DATE' using errcode = '22023';
  end if;
  for row_value in
    select r.user_id,r.revision,r.payload from public.xiaoman_user_resources r
    where r.resource = 'ledger' and (owner_filter is null or r.user_id = any(owner_filter)) and (
      (r.payload#>'{salaryBudget,enabled}' = 'true'::jsonb and r.payload#>'{salaryBudget,autoIncome,enabled}' = 'true'::jsonb) or
      (r.payload#>'{otherLedgers,personal,salaryBudget,enabled}' = 'true'::jsonb and r.payload#>'{otherLedgers,personal,salaryBudget,autoIncome,enabled}' = 'true'::jsonb) or
      (r.payload#>'{otherLedgers,family,salaryBudget,enabled}' = 'true'::jsonb and r.payload#>'{otherLedgers,family,salaryBudget,autoIncome,enabled}' = 'true'::jsonb) or
      (r.payload#>'{otherLedgers,travel,salaryBudget,enabled}' = 'true'::jsonb and r.payload#>'{otherLedgers,travel,salaryBudget,autoIncome,enabled}' = 'true'::jsonb))
    order by r.user_id for update skip locked
  loop
    checked := checked + 1;
    begin
      updated_payload := xiaoman_private.apply_recurring_salary(row_value.payload,run_date);
      if updated_payload is distinct from row_value.payload then
        updated_payload := jsonb_set(updated_payload,'{revision}',to_jsonb(row_value.revision+1),false);
        update public.xiaoman_user_resources r set revision = row_value.revision+1,payload = updated_payload
          where r.user_id = row_value.user_id and r.resource = 'ledger' and r.revision = row_value.revision;
        get diagnostics affected = row_count;
        if affected <> 1 then raise exception 'XIAOMAN_CONFLICT' using errcode = '40001'; end if;
        changed := changed + 1;
      end if;
    exception when others then
      -- A malformed/full resource must not prevent other accounts from progressing.
      -- Deliberately omit account IDs, transaction text, amounts, and SQLERRM.
      failed := failed + 1;
    end;
  end loop;
  if failed > 0 then raise warning 'XIAOMAN_SALARY_RESOURCES_FAILED: %', failed; end if;
  return jsonb_build_object('checked',checked,'changed',changed,'failed',failed);
end;
$$;

revoke all on all functions in schema xiaoman_private from public, anon, authenticated;
