-- FuelTech Accounting online storage.
-- Run in Supabase SQL Editor for the accounting-6 live app.

create table if not exists public.fueltech_reports (
  report_key text primary key,
  branch text not null check (branch in ('Mabolo', 'Arpili', 'Liloan', 'Pondol', 'Barili', 'Moalboal')),
  report_date date not null,
  shift_id text not null check (shift_id in ('shift-1', 'shift-2', 'shift-3')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists fueltech_reports_branch_date_idx
on public.fueltech_reports(branch, report_date, shift_id);

create table if not exists public.fueltech_price_book (
  branch text not null check (branch in ('Mabolo', 'Arpili', 'Liloan', 'Pondol', 'Barili', 'Moalboal')),
  effective_date date not null,
  coverage text not null default 'Daily' check (coverage in ('Daily', 'Shift')),
  shift_id text not null default 'daily' check (shift_id in ('daily', 'shift-1', 'shift-2', 'shift-3')),
  prices jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (branch, effective_date, coverage, shift_id)
);

create table if not exists public.fueltech_backups (
  backup_date date primary key,
  report_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fueltech_system_health (
  check_date date primary key,
  payload jsonb not null default '{}'::jsonb,
  missing_reports integer not null default 0,
  missing_deposits integer not null default 0,
  pending_deposits integer not null default 0,
  cash_variance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fueltech_price_book
  add column if not exists coverage text not null default 'Daily';

alter table public.fueltech_price_book
  add column if not exists shift_id text not null default 'daily';

alter table public.fueltech_price_book
  drop constraint if exists fueltech_price_book_pkey;

alter table public.fueltech_price_book
  add constraint fueltech_price_book_pkey primary key (branch, effective_date, coverage, shift_id);

alter table public.fueltech_price_book
  drop constraint if exists fueltech_price_book_coverage_check;

alter table public.fueltech_price_book
  add constraint fueltech_price_book_coverage_check check (coverage in ('Daily', 'Shift'));

alter table public.fueltech_price_book
  drop constraint if exists fueltech_price_book_shift_id_check;

alter table public.fueltech_price_book
  add constraint fueltech_price_book_shift_id_check check (shift_id in ('daily', 'shift-1', 'shift-2', 'shift-3'));

alter table public.fueltech_reports enable row level security;
alter table public.fueltech_price_book enable row level security;
alter table public.fueltech_backups enable row level security;
alter table public.fueltech_system_health enable row level security;

grant select, insert, update, delete on public.fueltech_reports to anon, authenticated;
grant select, insert, update, delete on public.fueltech_price_book to anon, authenticated;
grant select, insert, update on public.fueltech_backups to anon, authenticated;
grant select, insert, update on public.fueltech_system_health to anon, authenticated;

drop policy if exists "FuelTech can read reports" on public.fueltech_reports;
create policy "FuelTech can read reports"
on public.fueltech_reports for select
to anon, authenticated
using (true);

drop policy if exists "FuelTech can save reports" on public.fueltech_reports;
create policy "FuelTech can save reports"
on public.fueltech_reports for insert
to anon, authenticated
with check (true);

drop policy if exists "FuelTech can update reports" on public.fueltech_reports;
create policy "FuelTech can update reports"
on public.fueltech_reports for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "FuelTech can read prices" on public.fueltech_price_book;
create policy "FuelTech can read prices"
on public.fueltech_price_book for select
to anon, authenticated
using (true);

drop policy if exists "FuelTech can save prices" on public.fueltech_price_book;
create policy "FuelTech can save prices"
on public.fueltech_price_book for insert
to anon, authenticated
with check (true);

drop policy if exists "FuelTech can update prices" on public.fueltech_price_book;
create policy "FuelTech can update prices"
on public.fueltech_price_book for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "FuelTech can read backups" on public.fueltech_backups;
create policy "FuelTech can read backups"
on public.fueltech_backups for select
to anon, authenticated
using (true);

drop policy if exists "FuelTech can save backups" on public.fueltech_backups;
create policy "FuelTech can save backups"
on public.fueltech_backups for insert
to anon, authenticated
with check (true);

drop policy if exists "FuelTech can update backups" on public.fueltech_backups;
create policy "FuelTech can update backups"
on public.fueltech_backups for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "FuelTech can read system health" on public.fueltech_system_health;
create policy "FuelTech can read system health"
on public.fueltech_system_health for select
to anon, authenticated
using (true);

drop policy if exists "FuelTech can save system health" on public.fueltech_system_health;
create policy "FuelTech can save system health"
on public.fueltech_system_health for insert
to anon, authenticated
with check (true);

drop policy if exists "FuelTech can update system health" on public.fueltech_system_health;
create policy "FuelTech can update system health"
on public.fueltech_system_health for update
to anon, authenticated
using (true)
with check (true);

-- Security hardening: browser clients do not read or write tables directly.
-- All app access goes through Vercel server routes, which enforce FuelTech role/session rules.
revoke select, insert, update, delete on public.fueltech_reports from anon, authenticated;
revoke select, insert, update, delete on public.fueltech_price_book from anon, authenticated;
revoke select, insert, update, delete on public.fueltech_backups from anon, authenticated;
revoke select, insert, update, delete on public.fueltech_system_health from anon, authenticated;

drop policy if exists "FuelTech can read reports" on public.fueltech_reports;
drop policy if exists "FuelTech can save reports" on public.fueltech_reports;
drop policy if exists "FuelTech can update reports" on public.fueltech_reports;
drop policy if exists "FuelTech can read prices" on public.fueltech_price_book;
drop policy if exists "FuelTech can save prices" on public.fueltech_price_book;
drop policy if exists "FuelTech can update prices" on public.fueltech_price_book;
drop policy if exists "FuelTech can read backups" on public.fueltech_backups;
drop policy if exists "FuelTech can save backups" on public.fueltech_backups;
drop policy if exists "FuelTech can update backups" on public.fueltech_backups;
drop policy if exists "FuelTech can read system health" on public.fueltech_system_health;
drop policy if exists "FuelTech can save system health" on public.fueltech_system_health;
drop policy if exists "FuelTech can update system health" on public.fueltech_system_health;
