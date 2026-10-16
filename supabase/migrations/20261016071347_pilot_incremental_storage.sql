-- Preserve the original aggregate and every existing backup. New writes are
-- atomic document deltas; compatibility reads still reconstruct the same JSON.
set lock_timeout='5s';
alter table public.fueltech_pilot_config add column storage_version integer not null default 1;
alter table public.fueltech_pilot_state rename to fueltech_pilot_state_legacy;
create table public.fueltech_pilot_heads(mode text primary key,revision bigint not null,audit_count bigint not null,updated_at timestamptz not null default now());
create table public.fueltech_pilot_documents(mode text not null,section text not null,item_key text not null,data jsonb not null,changed_revision bigint not null,primary key(mode,section,item_key));
create index fueltech_pilot_documents_revision_idx on public.fueltech_pilot_documents(mode,changed_revision);
create table public.fueltech_pilot_audit(mode text not null,sequence bigint not null,data jsonb not null,primary key(mode,sequence));
create table public.fueltech_pilot_journal(mode text not null,revision bigint not null,patch jsonb not null,created_at timestamptz not null default now(),primary key(mode,revision));
create table public.fueltech_pilot_checkpoints(mode text not null,revision bigint not null,data jsonb not null,created_at timestamptz not null default now(),primary key(mode,revision));
alter table public.fueltech_pilot_heads enable row level security;
alter table public.fueltech_pilot_documents enable row level security;
alter table public.fueltech_pilot_audit enable row level security;
alter table public.fueltech_pilot_journal enable row level security;
alter table public.fueltech_pilot_checkpoints enable row level security;
revoke all on public.fueltech_pilot_heads,public.fueltech_pilot_documents,public.fueltech_pilot_audit,public.fueltech_pilot_journal,public.fueltech_pilot_checkpoints from public,anon,authenticated;
grant select,insert,update on public.fueltech_pilot_heads,public.fueltech_pilot_documents to service_role;
grant delete on public.fueltech_pilot_documents to service_role;
grant select,insert on public.fueltech_pilot_audit,public.fueltech_pilot_journal,public.fueltech_pilot_checkpoints to service_role;
revoke insert,update on public.fueltech_pilot_state_legacy from service_role;

create function public.fueltech_pilot_split(p_data jsonb)
returns table(section text,key text,data jsonb) language sql immutable security invoker set search_path='' as $$
 select 'root',key,value from jsonb_each(p_data-ARRAY['reports','photos','audit','posRedemptionSync'])
 union all select 'reports',key,value from jsonb_each(coalesce(p_data->'reports','{}'))
 union all select 'photos',key,value from jsonb_each(coalesce(p_data->'photos','{}'))
 union all select 'shape','pos',to_jsonb(case when not(p_data?'posRedemptionSync') then 'missing' when p_data->'posRedemptionSync'='null'::jsonb then 'null' else 'object' end)
 union all select 'pos',key,value from jsonb_each(case when jsonb_typeof(p_data->'posRedemptionSync')='object' then (p_data->'posRedemptionSync')-ARRAY['rows','points'] else '{}' end)
 union all select 'pos_rows',value->>'id',value from jsonb_array_elements(coalesce(p_data->'posRedemptionSync'->'rows','[]'))
 union all select 'pos_points',value->>'id',value from jsonb_array_elements(coalesce(p_data->'posRedemptionSync'->'points','[]'))
 union all select 'shape',kind,coalesce((select jsonb_agg(value->>'id' order by ord) from jsonb_array_elements(p_data->'posRedemptionSync'->kind) with ordinality a(value,ord)),'[]')
 from (values('rows'),('points')) k(kind) where jsonb_typeof(p_data->'posRedemptionSync'->kind)='array';
$$;
create function public.fueltech_pilot_join_docs(p_docs jsonb,p_audit jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select coalesce(p_docs->'root','{}')||jsonb_build_object('reports',coalesce(p_docs->'reports','{}'),'photos',coalesce(p_docs->'photos','{}'),'audit',p_audit)
 ||case when p_docs->'shape'->>'pos'='null' then jsonb_build_object('posRedemptionSync',null)
 when p_docs->'shape'->>'pos'='object' then jsonb_build_object('posRedemptionSync',coalesce(p_docs->'pos','{}')
 ||case when p_docs->'shape'?'rows' then jsonb_build_object('rows',coalesce((select jsonb_agg(p_docs->'pos_rows'->id order by ord) from jsonb_array_elements_text(p_docs->'shape'->'rows') with ordinality a(id,ord)),'[]')) else '{}' end
 ||case when p_docs->'shape'?'points' then jsonb_build_object('points',coalesce((select jsonb_agg(p_docs->'pos_points'->id order by ord) from jsonb_array_elements_text(p_docs->'shape'->'points') with ordinality a(id,ord)),'[]')) else '{}' end) else '{}' end;
$$;
create function public.fueltech_pilot_assemble(p_mode text,p_audit_limit integer default -1,p_before bigint default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.fueltech_pilot_join_docs(
 coalesce((select jsonb_object_agg(section,items) from (select section,jsonb_object_agg(item_key,data) items from public.fueltech_pilot_documents where mode=p_mode group by section) d),'{}'),
 coalesce((select jsonb_agg(data order by sequence) from (select sequence,data from public.fueltech_pilot_audit where mode=p_mode and (p_before is null or sequence<p_before) order by sequence desc limit case when p_audit_limit<0 then null else p_audit_limit end) a),'[]'));
$$;
insert into public.fueltech_pilot_heads select mode,revision,jsonb_array_length(data->'audit'),updated_at from public.fueltech_pilot_state_legacy;
insert into public.fueltech_pilot_documents select s.mode,d.section,d.key,d.data,s.revision from public.fueltech_pilot_state_legacy s cross join lateral public.fueltech_pilot_split(s.data) d;
insert into public.fueltech_pilot_audit select s.mode,a.ord,a.value from public.fueltech_pilot_state_legacy s cross join lateral jsonb_array_elements(s.data->'audit') with ordinality a(value,ord);
create view public.fueltech_pilot_state with(security_invoker=true) as select mode,revision,public.fueltech_pilot_assemble(mode) data,updated_at from public.fueltech_pilot_heads;
revoke all on public.fueltech_pilot_state from public,anon,authenticated;
grant select on public.fueltech_pilot_state to service_role;

create function public.fueltech_pilot_load_v2(p_mode text,p_audit_limit integer default 0,p_before bigint default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('revision',revision,'data',public.fueltech_pilot_assemble(p_mode,least(greatest(p_audit_limit,0),100),p_before),'auditCursor',case when p_audit_limit>0 then (select min(sequence) from (select sequence from public.fueltech_pilot_audit where mode=p_mode and(p_before is null or sequence<p_before) order by sequence desc limit least(p_audit_limit,100)) a) end) from public.fueltech_pilot_heads where mode=p_mode;
$$;

create function public.fueltech_pilot_commit_v2(p_mode text,p_revision bigint,p_mutation uuid,p_hash text,p_patch jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg public.fueltech_pilot_config; head public.fueltech_pilot_heads; receipt public.fueltech_pilot_receipts; item record; prior jsonb; row_value jsonb; patch_row jsonb; section_name text; key_name text; new_revision bigint;
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
  if section_name in ('reports','photos') or (section_name='root' and key_name in ('mode','startDate')) then raise exception 'Saved station records cannot be removed';end if;
  delete from public.fueltech_pilot_documents where mode=p_mode and section=section_name and item_key=key_name;
 end loop;
 for patch_row in select value from jsonb_array_elements(p_patch->'upserts') loop
  section_name:=patch_row->>'section';key_name:=patch_row->>'key';row_value:=patch_row->'data';
  if section_name not in ('root','reports','photos','pos','pos_rows','pos_points','shape') or key_name is null or row_value is null then raise exception 'Invalid station document';end if;
  select data into prior from public.fueltech_pilot_documents where mode=p_mode and section=section_name and item_key=key_name;
  if section_name='root' and ((key_name='mode' and row_value is distinct from to_jsonb(p_mode)) or (key_name='startDate' and row_value is distinct from to_jsonb(cfg.start_date::text))) then raise exception 'Invalid pilot boundary';end if;
  if section_name='reports' then
    if row_value->>'branch' is distinct from 'Liloan' or key_name is distinct from concat('Liloan__',row_value->>'date','__',row_value->>'shiftId') then raise exception 'Pilot station violation';end if;
    -- Historical protection is identical to the current production writer.
    if prior is not null and (row_value->>'date')::date<cfg.start_date and prior<>row_value then
      if p_mode<>'live' or prior->>'confirmed'<>'true' or coalesce(prior->>'baselineReport','false')='true'
        or row_value->'posRedemptions'->>'automatic' IS DISTINCT FROM 'true'
        or (prior - ARRAY['deductions','pointsIssued','pointsWithdrawn','posRedemptions','posAutomaticAdjustment','integrationIssues','checkDetails','checkCategories','checkRequired','pilotRevision','pilotLastNonReadingRevision','serverMeta'])
          IS DISTINCT FROM (row_value - ARRAY['deductions','pointsIssued','pointsWithdrawn','posRedemptions','posAutomaticAdjustment','integrationIssues','checkDetails','checkCategories','checkRequired','pilotRevision','pilotLastNonReadingRevision','serverMeta'])
        or ((prior->'deductions') - ARRAY['cashRedemption','fuelRedemption','posRedemption']) IS DISTINCT FROM ((row_value->'deductions') - ARRAY['cashRedemption','fuelRedemption','posRedemption'])
        or coalesce((row_value->'deductions'->>'cashRedemption')::numeric,-1)<>0 or coalesce((row_value->'deductions'->>'fuelRedemption')::numeric,-1)<>0
        or (row_value->'deductions'->'posRedemption') IS DISTINCT FROM (row_value->'posRedemptions'->'cashTotal') then raise exception 'Historical report modification prohibited';end if;
    end if;
    if p_mode='live' and ((row_value->>'date')::date>=cfg.start_date or (prior->>'confirmed'='true' and row_value->'posRedemptions'->>'automatic'='true')) and prior is distinct from row_value then
     insert into public.fueltech_reports(report_key,branch,report_date,shift_id,data,updated_at) values(key_name,'Liloan',(row_value->>'date')::date,row_value->>'shiftId',row_value,clock_timestamp())
     on conflict(report_key) do update set data=excluded.data,updated_at=excluded.updated_at;
    end if;
  end if;
  if section_name='root' and key_name='priceBook' and p_mode='live' then
   for item in select key,value from jsonb_each(row_value->'Liloan') loop
    if split_part(item.key,'__',1)::date>=cfg.start_date and prior->'Liloan'->item.key is distinct from item.value then
     insert into public.fueltech_price_book(branch,effective_date,coverage,shift_id,prices,updated_at) values('Liloan',split_part(item.key,'__',1)::date,case when position('__' in item.key)>0 then 'Shift' else 'Daily' end,case when position('__' in item.key)>0 then split_part(item.key,'__',2) else 'daily' end,item.value,clock_timestamp())
     on conflict(branch,effective_date,coverage,shift_id) do update set prices=excluded.prices,updated_at=excluded.updated_at;
    end if;
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
end $$;

-- Already-open deployments retain their original RPC and full-state read shape.
create or replace function public.fueltech_pilot_commit(p_mode text,p_revision bigint,p_mutation uuid,p_hash text,p_data jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare patch jsonb; audit_count bigint; prior_audit jsonb; current_revision bigint;
begin
 perform pg_advisory_xact_lock(43918,1);
 select h.audit_count,h.revision into audit_count,current_revision from public.fueltech_pilot_heads h where mode=p_mode;
 if coalesce(current_revision,0)<>p_revision then return public.fueltech_pilot_commit_v2(p_mode,p_revision,p_mutation,p_hash,'{}',p_result);end if;
 select coalesce(jsonb_agg(data order by sequence),'[]') into prior_audit from public.fueltech_pilot_audit where mode=p_mode;
 -- Receipts must remain replayable after subsequent audit events were appended.
 if exists(select 1 from public.fueltech_pilot_receipts where mode=p_mode and mutation_id=p_mutation) then return public.fueltech_pilot_commit_v2(p_mode,p_revision,p_mutation,p_hash,'{}',p_result);end if;
 if (select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(p_data->'audit') with ordinality a(value,ord) where ord<=coalesce(audit_count,0)) is distinct from prior_audit then raise exception 'Saved audit events are immutable';end if;
 select jsonb_build_object('upserts',coalesce((select jsonb_agg(jsonb_build_object('section',n.section,'key',n.key,'data',n.data)) from public.fueltech_pilot_split(p_data) n left join public.fueltech_pilot_documents d on d.mode=p_mode and d.section=n.section and d.item_key=n.key where d.data is distinct from n.data),'[]'),
 'removals',coalesce((select jsonb_agg(jsonb_build_object('section',d.section,'key',d.item_key)) from public.fueltech_pilot_documents d where mode=p_mode and not exists(select 1 from public.fueltech_pilot_split(p_data) n where n.section=d.section and n.key=d.item_key)),'[]'),
 'audit',coalesce((select jsonb_agg(value order by ord) from jsonb_array_elements(p_data->'audit') with ordinality a(value,ord) where ord>coalesce(audit_count,0)),'[]')) into patch;
 return public.fueltech_pilot_commit_v2(p_mode,p_revision,p_mutation,p_hash,patch,p_result);
end $$;

create function public.fueltech_pilot_restore_revision(p_mode text,p_revision bigint)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare state jsonb; docs jsonb; events jsonb; base_revision bigint; entry record; change jsonb;
begin
 select revision,data into base_revision,state from (select revision,data from public.fueltech_pilot_state_legacy where mode=p_mode union all select revision,data from public.fueltech_pilot_checkpoints where mode=p_mode) b where revision<=p_revision order by revision desc limit 1;
 if state is null then raise exception 'Use a retained legacy backup for this revision';end if;
 select coalesce(jsonb_object_agg(section,items),'{}') into docs from (select section,jsonb_object_agg(key,data) items from public.fueltech_pilot_split(state) group by section) d;
 events:=state->'audit';
 for entry in select revision,patch from public.fueltech_pilot_journal where mode=p_mode and revision>base_revision and revision<=p_revision order by revision loop
  if entry.revision<>base_revision+1 then raise exception 'Recovery journal has a gap';end if;
  for change in select value from jsonb_array_elements(entry.patch->'removals') loop docs:=docs #- ARRAY[change->>'section',change->>'key'];end loop;
  for change in select value from jsonb_array_elements(entry.patch->'upserts') loop
   docs:=jsonb_set(docs,ARRAY[change->>'section'],coalesce(docs->(change->>'section'),'{}'),true);
   docs:=jsonb_set(docs,ARRAY[change->>'section',change->>'key'],change->'data',true);
  end loop;
  events:=events||(entry.patch->'audit');base_revision:=entry.revision;
 end loop;
 if base_revision<>p_revision then raise exception 'Recovery revision is unavailable';end if;
 return public.fueltech_pilot_join_docs(docs,events);
end $$;
create function public.fueltech_pilot_checkpoint(p_mode text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare head public.fueltech_pilot_heads;
begin
 perform pg_advisory_xact_lock(43918,1);
 select * into head from public.fueltech_pilot_heads where mode=p_mode;
 if head.mode is not null and not exists(select 1 from public.fueltech_pilot_checkpoints where mode=p_mode and created_at>=date_trunc('day',now())) then
 insert into public.fueltech_pilot_checkpoints(mode,revision,data) values(p_mode,head.revision,public.fueltech_pilot_assemble(p_mode)) on conflict do nothing;end if;
 return head.revision;
end $$;
create function public.fueltech_pilot_changes_v2(p_mode text,p_since bigint,p_through bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('full',coalesce(bool_or(section not in ('reports','photos')),false),'keys',coalesce(jsonb_agg(distinct key) filter(where section='reports'),'[]'))
 from (select c->>'section' section,c->>'key' key from public.fueltech_pilot_journal j cross join lateral jsonb_array_elements((j.patch->'upserts')||(j.patch->'removals')) c where j.mode=p_mode and j.revision>p_since and j.revision<=p_through) changes;
$$;
do $$begin
 if exists(select 1 from public.fueltech_pilot_state_legacy l join public.fueltech_pilot_state v using(mode) where l.revision<>v.revision or l.data is distinct from v.data) then raise exception 'Normalized migration failed exact preservation check';end if;
end $$;
update public.fueltech_pilot_config set storage_version=2;
revoke all on function public.fueltech_pilot_split(jsonb),public.fueltech_pilot_join_docs(jsonb,jsonb),public.fueltech_pilot_assemble(text,integer,bigint),public.fueltech_pilot_load_v2(text,integer,bigint),public.fueltech_pilot_commit_v2(text,bigint,uuid,text,jsonb,jsonb),public.fueltech_pilot_restore_revision(text,bigint),public.fueltech_pilot_checkpoint(text),public.fueltech_pilot_changes_v2(text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.fueltech_pilot_split(jsonb),public.fueltech_pilot_join_docs(jsonb,jsonb),public.fueltech_pilot_assemble(text,integer,bigint),public.fueltech_pilot_load_v2(text,integer,bigint),public.fueltech_pilot_commit_v2(text,bigint,uuid,text,jsonb,jsonb),public.fueltech_pilot_restore_revision(text,bigint),public.fueltech_pilot_checkpoint(text),public.fueltech_pilot_changes_v2(text,bigint,bigint) to service_role;
notify pgrst,'reload schema';
