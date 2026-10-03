-- Restore the server-only store expected by health checks and admin push registration.
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
alter table public.fueltech_system_health enable row level security;
revoke all on public.fueltech_system_health from public, anon, authenticated;
grant select, insert, update, delete on public.fueltech_system_health to service_role;
notify pgrst, 'reload schema';
