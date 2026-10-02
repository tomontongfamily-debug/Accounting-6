-- Decode the stored report map once, rather than repeatedly copying the full history per row.
create or replace function public.fueltech_pilot_commit(p_mode text,p_revision bigint,p_mutation uuid,p_hash text,p_data jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_row public.fueltech_pilot_state; receipt public.fueltech_pilot_receipts;
  cfg public.fueltech_pilot_config; item record; prior jsonb; old_reports jsonb; new_reports jsonb; old_prices jsonb;
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
  old_reports:=current_row.data->'reports';
  new_reports:=p_data->'reports';
  old_prices:=current_row.data->'priceBook'->'Liloan';
  if p_data->>'mode'<>p_mode or (p_data->>'startDate')::date<>cfg.start_date then raise exception 'Invalid pilot boundary'; end if;
  for item in select key,value from jsonb_each(new_reports) loop
    if item.value->>'branch'<>'Liloan' then raise exception 'Pilot station violation'; end if;
    prior:=old_reports->item.key;
    if prior is not null and (item.value->>'date')::date<cfg.start_date and prior<>item.value then raise exception 'Historical report modification prohibited'; end if;
  end loop;
  if current_row.data is not null and (old_reports is distinct from new_reports or (current_row.data->'deposits') is distinct from (p_data->'deposits') or (current_row.data->'priceBook') is distinct from (p_data->'priceBook')) then
    insert into public.fueltech_pilot_backups(mode,revision,data) values(p_mode,current_row.revision,current_row.data) on conflict do nothing;
  end if;
  if p_mode='live' then
    perform set_config('fueltech.pilot_writer','on',true);
    for item in select key,value from jsonb_each(new_reports) loop
      if (item.value->>'date')::date>=cfg.start_date and (old_reports->item.key) is distinct from item.value then
        insert into public.fueltech_reports(report_key,branch,report_date,shift_id,data,updated_at)
          values(item.key,'Liloan',(item.value->>'date')::date,item.value->>'shiftId',item.value,clock_timestamp())
          on conflict(report_key) do update set data=excluded.data,updated_at=excluded.updated_at;
      end if;
    end loop;
    -- Preserve both daily and per-shift price entries; never overwrite earlier prices.
    for item in select key,value from jsonb_each(p_data->'priceBook'->'Liloan') loop
      if split_part(item.key,'__',1)::date>=cfg.start_date and (old_prices->item.key) is distinct from item.value then
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
