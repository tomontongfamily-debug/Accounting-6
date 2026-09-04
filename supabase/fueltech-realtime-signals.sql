-- Lightweight change notifications for the FuelTech web app.
-- The browser can read only this non-sensitive signal table. Accounting rows
-- remain private and continue to load through authenticated Vercel API routes.

create table if not exists public.fueltech_realtime_signals (
  topic text primary key check (topic in ('reports', 'prices')),
  version bigint not null default 0,
  changed_at timestamptz not null default now()
);

insert into public.fueltech_realtime_signals (topic)
values ('reports'), ('prices')
on conflict (topic) do nothing;

alter table public.fueltech_realtime_signals enable row level security;

revoke all on public.fueltech_realtime_signals from anon, authenticated;
grant select on public.fueltech_realtime_signals to anon, authenticated;

drop policy if exists "FuelTech can receive change signals" on public.fueltech_realtime_signals;
create policy "FuelTech can receive change signals"
on public.fueltech_realtime_signals
for select
to anon, authenticated
using (true);

create or replace function public.fueltech_touch_realtime_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  signal_topic text;
begin
  signal_topic := case TG_TABLE_NAME
    when 'fueltech_reports' then 'reports'
    when 'fueltech_price_book' then 'prices'
  end;

  if signal_topic is not null then
    insert into public.fueltech_realtime_signals (topic, version, changed_at)
    values (signal_topic, 1, now())
    on conflict (topic) do update
      set version = public.fueltech_realtime_signals.version + 1,
          changed_at = excluded.changed_at;
  end if;

  return null;
end;
$$;

drop trigger if exists fueltech_reports_realtime_signal on public.fueltech_reports;
create trigger fueltech_reports_realtime_signal
after insert or update or delete on public.fueltech_reports
for each statement execute function public.fueltech_touch_realtime_signal();

drop trigger if exists fueltech_prices_realtime_signal on public.fueltech_price_book;
create trigger fueltech_prices_realtime_signal
after insert or update or delete on public.fueltech_price_book
for each statement execute function public.fueltech_touch_realtime_signal();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fueltech_realtime_signals'
  ) then
    execute 'alter publication supabase_realtime add table public.fueltech_realtime_signals';
  end if;
end;
$$;
