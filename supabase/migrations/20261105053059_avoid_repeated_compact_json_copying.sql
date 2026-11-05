-- Build each metadata map once. Nesting those maps in a second aggregate and
-- decoding the combined document copied the large report history repeatedly.
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(43918,1);
create temporary table compact_copy_preservation on commit drop as
 select mode,md5(public.fueltech_pilot_load_compact(mode,0,null)::text) digest
 from public.fueltech_pilot_heads;

create or replace function public.fueltech_pilot_load_compact(p_mode text,p_audit_limit integer default 0,p_before bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare head public.fueltech_pilot_heads; roots jsonb; reports jsonb; photos jsonb; shape jsonb; pos jsonb; events jsonb; state jsonb; audit_cursor bigint;
begin
 select * into head from public.fueltech_pilot_heads where mode=p_mode;
 if head.mode is null then return null;end if;
 select coalesce(jsonb_object_agg(item_key,data) filter(where section='root'),'{}'),
  coalesce(jsonb_object_agg(item_key,data) filter(where section='reports'),'{}'),
  coalesce(jsonb_object_agg(item_key,data) filter(where section='photos'),'{}'),
  coalesce(jsonb_object_agg(item_key,data) filter(where section='shape'),'{}'),
  coalesce(jsonb_object_agg(item_key,data) filter(where section='pos'),'{}')
 into roots,reports,photos,shape,pos from public.fueltech_pilot_documents
 where mode=p_mode and section not in ('pos_rows','pos_points') and not(section='shape' and item_key in ('rows','points'));
 select coalesce(jsonb_agg(data order by sequence),'[]'),min(sequence) into events,audit_cursor from
  (select sequence,data from public.fueltech_pilot_audit where mode=p_mode and(p_before is null or sequence<p_before)
   order by sequence desc limit least(greatest(p_audit_limit,0),100)) a;
 state:=roots||jsonb_build_object('reports',reports,'photos',photos,'audit',events);
 if shape->>'pos'='null' then state:=state||jsonb_build_object('posRedemptionSync',null);
 elsif shape->>'pos'='object' then state:=state||jsonb_build_object('posRedemptionSync',pos||jsonb_build_object('_deferred',true));end if;
 return jsonb_build_object('revision',head.revision,'data',state,'auditCursor',audit_cursor);
end $$;

do $$begin
 if exists(select 1 from compact_copy_preservation p where p.digest is distinct from md5(public.fueltech_pilot_load_compact(p.mode,0,null)::text)) then
  raise exception 'Compact read optimization changed station records';
 end if;
end $$;
revoke all on function public.fueltech_pilot_load_compact(text,integer,bigint) from public,anon,authenticated;
grant execute on function public.fueltech_pilot_load_compact(text,integer,bigint) to service_role;
notify pgrst,'reload schema';
