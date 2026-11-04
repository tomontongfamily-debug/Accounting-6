-- Owner-authorized rollout: Nov 4 Shift 3 setup; first reporting Nov 5 Shift 1.
-- Liloan keeps its Oct 3 boundary. All historical rows are retained.
alter table public.fueltech_pilot_config drop constraint fueltech_pilot_config_branch_check;
alter table public.fueltech_pilot_config add constraint fueltech_pilot_config_branch_check check(branch in ('Mabolo','Arpili','Liloan','Pondol','Barili','Moalboal'));
insert into public.fueltech_pilot_config(branch,mode,start_date,storage_version)
select branch,'live','2026-11-05'::date,2 from unnest(array['Mabolo','Arpili','Pondol','Barili','Moalboal']) branch
on conflict(branch) do nothing;
CREATE OR REPLACE FUNCTION public.fueltech_pilot_commit_v2(p_mode text, p_revision bigint, p_mutation uuid, p_hash text, p_patch jsonb, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cfg public.fueltech_pilot_config; branch_cfg public.fueltech_pilot_config; book record; head public.fueltech_pilot_heads; receipt public.fueltech_pilot_receipts; item record; prior jsonb; row_value jsonb; patch_row jsonb; section_name text; key_name text; new_revision bigint;
begin
 select * into cfg from public.fueltech_pilot_config where branch='Liloan' for share;
 if cfg.mode is distinct from p_mode or cfg.mode='disabled' then raise exception 'Pilot configuration changed' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(43918,1);
 select * into receipt from public.fueltech_pilot_receipts where mode=p_mode and mutation_id=p_mutation;
 if found then if receipt.request_hash<>p_hash then raise exception 'Mutation ID reused with different data';end if;return receipt.result;end if;
 select * into head from public.fueltech_pilot_heads where mode=p_mode for update;
 if coalesce(head.revision,0)<>p_revision then raise exception 'Concurrent save: refresh and retry' using errcode='PT409';end if;
 new_revision:=p_revision+1;
 perform set_config('fueltech.pilot_writer','on',true);
 for patch_row in select value from jsonb_array_elements(p_patch->'removals') loop
  section_name:=patch_row->>'section';key_name:=patch_row->>'key';
  if section_name in ('reports','photos') or (section_name='root' and key_name in ('mode','startDate','stationStarts','branches','rolloutVersion')) then raise exception 'Saved station records cannot be removed';end if;
  delete from public.fueltech_pilot_documents where mode=p_mode and section=section_name and item_key=key_name;
 end loop;
 for patch_row in select value from jsonb_array_elements(p_patch->'upserts') loop
  section_name:=patch_row->>'section';key_name:=patch_row->>'key';row_value:=patch_row->'data';
  if section_name not in ('root','reports','photos','pos','pos_rows','pos_points','shape') or key_name is null or row_value is null then raise exception 'Invalid station document';end if;
  select data into prior from public.fueltech_pilot_documents where mode=p_mode and section=section_name and item_key=key_name;
  if section_name='root' and ((key_name='mode' and row_value is distinct from to_jsonb(p_mode)) or (key_name='startDate' and row_value is distinct from to_jsonb(cfg.start_date::text))) then raise exception 'Invalid pilot boundary';end if;
  if section_name='reports' then
    select * into branch_cfg from public.fueltech_pilot_config where branch=row_value->>'branch';
    if branch_cfg.mode is distinct from p_mode or key_name is distinct from concat(row_value->>'branch','__',row_value->>'date','__',row_value->>'shiftId') then raise exception 'Pilot station violation';end if;
    -- Historical protection is identical to the current production writer.
    if prior is not null and (row_value->>'date')::date<branch_cfg.start_date and prior<>row_value and not (row_value->>'branch'<>'Liloan' and (row_value->>'date')::date=branch_cfg.start_date-1 and row_value->>'shiftId'='shift-3' and row_value->>'baselineReport'='true' and coalesce(prior->>'confirmed','false')<>'true') then
      if p_mode<>'live' or prior->>'confirmed'<>'true' or coalesce(prior->>'baselineReport','false')='true'
        or row_value->'posRedemptions'->>'automatic' IS DISTINCT FROM 'true'
        or (prior - ARRAY['deductions','pointsIssued','pointsWithdrawn','posRedemptions','posAutomaticAdjustment','integrationIssues','checkDetails','checkCategories','checkRequired','pilotRevision','pilotLastNonReadingRevision','serverMeta'])
          IS DISTINCT FROM (row_value - ARRAY['deductions','pointsIssued','pointsWithdrawn','posRedemptions','posAutomaticAdjustment','integrationIssues','checkDetails','checkCategories','checkRequired','pilotRevision','pilotLastNonReadingRevision','serverMeta'])
        or ((prior->'deductions') - ARRAY['cashRedemption','fuelRedemption','posRedemption']) IS DISTINCT FROM ((row_value->'deductions') - ARRAY['cashRedemption','fuelRedemption','posRedemption'])
        or coalesce((row_value->'deductions'->>'cashRedemption')::numeric,-1)<>0 or coalesce((row_value->'deductions'->>'fuelRedemption')::numeric,-1)<>0
        or (row_value->'deductions'->'posRedemption') IS DISTINCT FROM (row_value->'posRedemptions'->'cashTotal') then raise exception 'Historical report modification prohibited';end if;
    end if;
    if p_mode='live' and ((row_value->>'date')::date>=branch_cfg.start_date or (row_value->>'branch'<>'Liloan' and (row_value->>'date')::date=branch_cfg.start_date-1 and row_value->>'shiftId'='shift-3' and row_value->>'baselineReport'='true') or (prior->>'confirmed'='true' and row_value->'posRedemptions'->>'automatic'='true')) and prior is distinct from row_value then
     insert into public.fueltech_reports(report_key,branch,report_date,shift_id,data,updated_at) values(key_name,row_value->>'branch',(row_value->>'date')::date,row_value->>'shiftId',row_value,clock_timestamp())
     on conflict(report_key) do update set data=excluded.data,updated_at=excluded.updated_at;
    end if;
  end if;
  if section_name='root' and key_name='priceBook' and p_mode='live' then
   for book in select key,value from jsonb_each(row_value) loop
    select * into branch_cfg from public.fueltech_pilot_config where branch=book.key;
    if branch_cfg.mode is distinct from p_mode then raise exception 'Price station violation';end if;
    for item in select key,value from jsonb_each(book.value) loop
     if split_part(item.key,'__',1)::date>=branch_cfg.start_date and prior->book.key->item.key is distinct from item.value then
      insert into public.fueltech_price_book(branch,effective_date,coverage,shift_id,prices,updated_at) values(book.key,split_part(item.key,'__',1)::date,case when position('__' in item.key)>0 then 'Shift' else 'Daily' end,case when position('__' in item.key)>0 then split_part(item.key,'__',2) else 'daily' end,item.value,clock_timestamp())
      on conflict(branch,effective_date,coverage,shift_id) do update set prices=excluded.prices,updated_at=excluded.updated_at;
     end if;
    end loop;
   end loop;
  end if;
  insert into public.fueltech_pilot_documents values(p_mode,section_name,key_name,row_value,new_revision)
  on conflict(mode,section,item_key) do update set data=excluded.data,changed_revision=excluded.changed_revision where fueltech_pilot_documents.data is distinct from excluded.data;
 end loop;
 if not exists(select 1 from public.fueltech_pilot_documents where mode=p_mode and section='root' and item_key='mode' and data=to_jsonb(p_mode)) or not exists(select 1 from public.fueltech_pilot_documents where mode=p_mode and section='root' and item_key='startDate' and data=to_jsonb(cfg.start_date::text)) then raise exception 'Invalid pilot boundary';end if;
 insert into public.fueltech_pilot_audit select p_mode,coalesce(head.audit_count,0)+a.ord,a.value from jsonb_array_elements(p_patch->'audit') with ordinality a(value,ord);
 insert into public.fueltech_pilot_heads values(p_mode,new_revision,coalesce(head.audit_count,0)+jsonb_array_length(p_patch->'audit'),clock_timestamp()) on conflict(mode) do update set revision=excluded.revision,audit_count=excluded.audit_count,updated_at=excluded.updated_at;
 insert into public.fueltech_pilot_journal(mode,revision,patch) values(p_mode,new_revision,p_patch);
 if head.mode is null then insert into public.fueltech_pilot_checkpoints(mode,revision,data) values(p_mode,new_revision,public.fueltech_pilot_assemble(p_mode));end if;
 insert into public.fueltech_pilot_receipts(mode,mutation_id,request_hash,result) values(p_mode,p_mutation,p_hash,p_result);
 return p_result;
end $function$;


CREATE OR REPLACE FUNCTION public.fueltech_pilot_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cfg public.fueltech_pilot_config; target jsonb;
begin
  target:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  select * into cfg from public.fueltech_pilot_config where branch=target->>'branch';
  if cfg.mode='live' and (coalesce(target->>'report_date',target->>'effective_date')::date>=cfg.start_date or (target->>'branch'<>'Liloan' and target->>'report_date'=(cfg.start_date-1)::text and target->>'shift_id'='shift-3')) and coalesce(current_setting('fueltech.pilot_writer',true),'')<>'on' then
    raise exception 'Use the new station workflow for reports and prices after cutover';
  end if;
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $function$;


notify pgrst,'reload schema';
