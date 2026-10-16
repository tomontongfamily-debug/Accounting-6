-- Decode POS maps once and join by ID; avoid copying a large map per row.
set lock_timeout='5s';
select pg_advisory_xact_lock(43918,1);
create temporary table pilot_read_preservation on commit drop as select mode,md5(data::text) digest from public.fueltech_pilot_state;
create or replace function public.fueltech_pilot_join_docs(p_docs jsonb,p_audit jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select coalesce(p_docs->'root','{}')||jsonb_build_object('reports',coalesce(p_docs->'reports','{}'),'photos',coalesce(p_docs->'photos','{}'),'audit',p_audit)
 ||case when p_docs->'shape'->>'pos'='null' then jsonb_build_object('posRedemptionSync',null)
 when p_docs->'shape'->>'pos'='object' then jsonb_build_object('posRedemptionSync',coalesce(p_docs->'pos','{}')
 ||case when p_docs->'shape'?'rows' then jsonb_build_object('rows',coalesce((select jsonb_agg(e.value order by a.ord) from jsonb_each(coalesce(p_docs->'pos_rows','{}')) e join jsonb_array_elements_text(p_docs->'shape'->'rows') with ordinality a(id,ord) on a.id=e.key),'[]')) else '{}' end
 ||case when p_docs->'shape'?'points' then jsonb_build_object('points',coalesce((select jsonb_agg(e.value order by a.ord) from jsonb_each(coalesce(p_docs->'pos_points','{}')) e join jsonb_array_elements_text(p_docs->'shape'->'points') with ordinality a(id,ord) on a.id=e.key),'[]')) else '{}' end) else '{}' end;
$$;

do $$begin if exists(select 1 from pilot_read_preservation b join public.fueltech_pilot_state s using(mode) where b.digest<>md5(s.data::text)) then raise exception 'Read optimization changed saved records';end if;end $$;

create function public.fueltech_pilot_load_compact(p_mode text,p_audit_limit integer default 0,p_before bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare head public.fueltech_pilot_heads; docs jsonb; events jsonb; state jsonb; audit_cursor bigint;
begin
 select * into head from public.fueltech_pilot_heads where mode=p_mode;
 if head.mode is null then return null;end if;
 select coalesce(jsonb_object_agg(section,items),'{}') into docs from
 (select section,jsonb_object_agg(item_key,data) items from public.fueltech_pilot_documents where mode=p_mode and section not in ('pos_rows','pos_points') and not(section='shape' and item_key in ('rows','points')) group by section) d;
 select coalesce(jsonb_agg(data order by sequence),'[]'),min(sequence) into events,audit_cursor from
 (select sequence,data from public.fueltech_pilot_audit where mode=p_mode and(p_before is null or sequence<p_before) order by sequence desc limit least(greatest(p_audit_limit,0),100)) a;
 state:=public.fueltech_pilot_join_docs(docs,events);
 if jsonb_typeof(state->'posRedemptionSync')='object' then state:=jsonb_set(state,'{posRedemptionSync,_deferred}','true');end if;
 return jsonb_build_object('revision',head.revision,'data',state,'auditCursor',audit_cursor);
end $$;
revoke all on function public.fueltech_pilot_load_compact(text,integer,bigint) from public,anon,authenticated;
grant execute on function public.fueltech_pilot_load_compact(text,integer,bigint) to service_role;
notify pgrst,'reload schema';
