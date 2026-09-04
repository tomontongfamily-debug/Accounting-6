-- FuelTech live Supabase security hardening
-- Run this in Supabase SQL Editor for the live project:
-- https://chqinknijqtixeenhtvu.supabase.co
--
-- This keeps the app working through the server, but blocks direct public
-- browser/API access to accounting tables.

alter table public.fueltech_reports enable row level security;
alter table public.fueltech_price_book enable row level security;

revoke select, insert, update, delete on public.fueltech_reports from anon, authenticated;
revoke select, insert, update, delete on public.fueltech_price_book from anon, authenticated;

drop policy if exists "FuelTech can read reports" on public.fueltech_reports;
drop policy if exists "FuelTech can save reports" on public.fueltech_reports;
drop policy if exists "FuelTech can update reports" on public.fueltech_reports;
drop policy if exists "FuelTech can read prices" on public.fueltech_price_book;
drop policy if exists "FuelTech can save prices" on public.fueltech_price_book;
drop policy if exists "FuelTech can update prices" on public.fueltech_price_book;

create table if not exists public.fueltech_backups (
  backup_date date primary key,
  report_count integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now()
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

alter table public.fueltech_backups enable row level security;
alter table public.fueltech_system_health enable row level security;

revoke select, insert, update, delete on public.fueltech_backups from anon, authenticated;
revoke select, insert, update, delete on public.fueltech_system_health from anon, authenticated;

drop policy if exists "FuelTech can save backups" on public.fueltech_backups;
drop policy if exists "FuelTech can read backups" on public.fueltech_backups;
drop policy if exists "FuelTech can update backups" on public.fueltech_backups;
drop policy if exists "FuelTech can save system health" on public.fueltech_system_health;
drop policy if exists "FuelTech can read system health" on public.fueltech_system_health;
drop policy if exists "FuelTech can update system health" on public.fueltech_system_health;
