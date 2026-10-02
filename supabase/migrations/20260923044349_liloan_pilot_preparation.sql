-- Additive preparation only: this migration does not enable or launch the pilot.
-- The deployed Accounting bundle uses /api/store/load and /api/reports/save;
-- direct anonymous access bypasses its role/PIN authorization.
revoke all on public.fueltech_reports,public.fueltech_price_book from public,anon,authenticated;
grant select,insert,update on public.fueltech_reports,public.fueltech_price_book to service_role;
create table public.fueltech_pilot_config (
  branch text primary key check(branch='Liloan'),
  mode text not null default 'disabled' check(mode in ('disabled','shadow','live')),
  start_date date,
  updated_at timestamptz not null default now(),
  check(mode='disabled' or start_date is not null)
);
insert into public.fueltech_pilot_config(branch) values('Liloan');
create table public.fueltech_pilot_baseline (
  id bigint generated always as identity primary key,
  branch text not null check(branch='Liloan'),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
insert into public.fueltech_pilot_baseline(branch,payload)
select 'Liloan',jsonb_build_object(
  'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.report_key) from public.fueltech_reports r where branch='Liloan'),'[]'::jsonb),
  'prices',coalesce((select jsonb_agg(to_jsonb(p) order by p.effective_date,p.coverage,p.shift_id) from public.fueltech_price_book p where branch='Liloan'),'[]'::jsonb)
);
create table public.fueltech_pilot_state (
  mode text primary key check(mode in ('shadow','live')),
  revision bigint not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.fueltech_pilot_receipts (
  mode text not null,
  mutation_id uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(mode,mutation_id)
);
create table public.fueltech_pilot_backups (
  id bigint generated always as identity primary key,
  mode text not null,
  revision bigint not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique(mode,revision)
);
alter table public.fueltech_pilot_config enable row level security;
alter table public.fueltech_pilot_baseline enable row level security;
alter table public.fueltech_pilot_state enable row level security;
alter table public.fueltech_pilot_receipts enable row level security;
alter table public.fueltech_pilot_backups enable row level security;
revoke all on public.fueltech_pilot_config,public.fueltech_pilot_state,public.fueltech_pilot_receipts,public.fueltech_pilot_backups from public,anon,authenticated;
revoke all on public.fueltech_pilot_baseline from public,anon,authenticated;
grant select on public.fueltech_pilot_baseline to service_role;
grant select on public.fueltech_pilot_config to service_role;
grant select,insert,update on public.fueltech_pilot_state to service_role;
grant select,insert on public.fueltech_pilot_receipts,public.fueltech_pilot_backups to service_role;
grant usage,select on sequence public.fueltech_pilot_backups_id_seq to service_role;

create function public.fueltech_pilot_commit(p_mode text,p_revision bigint,p_mutation uuid,p_hash text,p_data jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_row public.fueltech_pilot_state; receipt public.fueltech_pilot_receipts;
  cfg public.fueltech_pilot_config; item record; prior jsonb;
begin
  select * into cfg from public.fueltech_pilot_config where branch='Liloan' for share;
  if cfg.mode<>p_mode or cfg.mode='disabled' then raise exception 'Pilot configuration changed' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(43918,1);
  select * into receipt from public.fueltech_pilot_receipts where mode=p_mode and mutation_id=p_mutation;
  if found then
    if receipt.request_hash<>p_hash then raise exception 'Mutation ID reused with different data'; end if;
    return receipt.result;
  end if;
  select * into current_row from public.fueltech_pilot_state where mode=p_mode for update;
  if coalesce(current_row.revision,0)<>p_revision then raise exception 'Concurrent save: refresh and retry' using errcode='40001'; end if;
  if p_data->>'mode'<>p_mode or (p_data->>'startDate')::date<>cfg.start_date then raise exception 'Invalid pilot boundary'; end if;
  for item in select key,value from jsonb_each(p_data->'reports') loop
    if item.value->>'branch'<>'Liloan' then raise exception 'Pilot station violation'; end if;
    prior:=current_row.data->'reports'->item.key;
    if prior is not null and (item.value->>'date')::date<cfg.start_date and prior<>item.value then raise exception 'Historical report modification prohibited'; end if;
  end loop;
  if current_row.data is not null and ((current_row.data->'reports') is distinct from (p_data->'reports') or (current_row.data->'deposits') is distinct from (p_data->'deposits') or (current_row.data->'priceBook') is distinct from (p_data->'priceBook')) then
    insert into public.fueltech_pilot_backups(mode,revision,data) values(p_mode,current_row.revision,current_row.data) on conflict do nothing;
  end if;
  if p_mode='live' then
    perform set_config('fueltech.pilot_writer','on',true);
    for item in select key,value from jsonb_each(p_data->'reports') loop
      if (item.value->>'date')::date>=cfg.start_date and (current_row.data->'reports'->item.key) is distinct from item.value then
        insert into public.fueltech_reports(report_key,branch,report_date,shift_id,data,updated_at)
          values(item.key,'Liloan',(item.value->>'date')::date,item.value->>'shiftId',item.value,clock_timestamp())
          on conflict(report_key) do update set data=excluded.data,updated_at=excluded.updated_at;
      end if;
    end loop;
    -- Preserve both daily and per-shift price entries; never overwrite earlier prices.
    for item in select key,value from jsonb_each(p_data->'priceBook'->'Liloan') loop
      if split_part(item.key,'__',1)::date>=cfg.start_date and (current_row.data->'priceBook'->'Liloan'->item.key) is distinct from item.value then
        insert into public.fueltech_price_book(branch,effective_date,coverage,shift_id,prices,updated_at)
          values('Liloan',split_part(item.key,'__',1)::date,case when position('__' in item.key)>0 then 'Shift' else 'Daily' end,case when position('__' in item.key)>0 then split_part(item.key,'__',2) else 'daily' end,item.value,clock_timestamp())
          on conflict(branch,effective_date,coverage,shift_id) do update set prices=excluded.prices,updated_at=excluded.updated_at;
      end if;
    end loop;
  end if;
  insert into public.fueltech_pilot_state(mode,revision,data) values(p_mode,p_revision+1,p_data)
    on conflict(mode) do update set revision=excluded.revision,data=excluded.data,updated_at=now();
  insert into public.fueltech_pilot_receipts(mode,mutation_id,request_hash,result) values(p_mode,p_mutation,p_hash,p_result);
  return p_result;
end $$;
revoke all on function public.fueltech_pilot_commit(text,bigint,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fueltech_pilot_commit(text,bigint,uuid,text,jsonb,jsonb) to service_role;

-- The old application's endpoints must not bypass the new checks after cutover.
create function public.fueltech_pilot_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare cfg public.fueltech_pilot_config; target jsonb;
begin
  target:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  select * into cfg from public.fueltech_pilot_config where branch='Liloan';
  if cfg.mode='live' and target->>'branch'='Liloan' and coalesce(target->>'report_date',target->>'effective_date')::date>=cfg.start_date and coalesce(current_setting('fueltech.pilot_writer',true),'')<>'on' then
    raise exception 'Use the Liloan pilot for reports and prices after cutover';
  end if;
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;
revoke all on function public.fueltech_pilot_guard() from public,anon,authenticated;
create trigger fueltech_pilot_report_guard before insert or update or delete on public.fueltech_reports for each row execute function public.fueltech_pilot_guard();
create trigger fueltech_pilot_price_guard before insert or update or delete on public.fueltech_price_book for each row execute function public.fueltech_pilot_guard();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fueltech-pilot-photos','fueltech-pilot-photos',false,2097152,array['image/jpeg'])
on conflict(id) do nothing;
-- No anon/authenticated storage policies: authorized server endpoints mediate every photo.
