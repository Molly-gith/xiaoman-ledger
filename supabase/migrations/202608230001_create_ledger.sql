create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  category text not null default '其他',
  note text not null,
  amount numeric(14,2) not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  source text not null default 'text' check (source in ('text', 'voice', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transactions_user_occurred_idx on public.transactions(user_id, occurred_at desc);
create index transactions_type_occurred_idx on public.transactions(type, occurred_at desc);

create table public.financial_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget numeric(14,2) not null default 15000 check (monthly_budget >= 0),
  savings_current numeric(14,2) not null default 0 check (savings_current >= 0),
  savings_goal numeric(14,2) not null default 100000 check (savings_goal >= 0),
  updated_at timestamptz not null default now()
);

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger transactions_touch_updated_at before update on public.transactions
for each row execute function public.touch_updated_at();
create trigger financial_settings_touch_updated_at before update on public.financial_settings
for each row execute function public.touch_updated_at();

create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  insert into public.financial_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

create function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false);
$$;

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.financial_settings enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));
create policy "profiles_insert_own" on public.profiles for insert to authenticated
with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "transactions_select_own_or_admin" on public.transactions for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "transactions_insert_own" on public.transactions for insert to authenticated
with check (user_id = (select auth.uid()));
create policy "transactions_update_own" on public.transactions for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "transactions_delete_own" on public.transactions for delete to authenticated
using (user_id = (select auth.uid()));

create policy "financial_settings_select_own_or_admin" on public.financial_settings for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "financial_settings_insert_own" on public.financial_settings for insert to authenticated
with check (user_id = (select auth.uid()));
create policy "financial_settings_update_own" on public.financial_settings for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.profiles, public.transactions, public.financial_settings from anon;
grant select, insert on public.profiles to authenticated;
revoke insert on public.profiles from authenticated;
grant insert (id, email, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update on public.financial_settings to authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

