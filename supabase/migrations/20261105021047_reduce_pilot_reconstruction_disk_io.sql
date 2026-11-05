-- A read optimization only: exact reconstruction is checked before commit.
set lock_timeout='5s';
select pg_advisory_xact_lock(43918,1);
create temporary table pilot_io_preservation on commit drop as
 select mode,md5(public.fueltech_pilot_load_v2(mode,100,null)::text) digest from public.fueltech_pilot_heads;
CREATE OR REPLACE FUNCTION public.fueltech_pilot_assemble(p_mode text, p_audit_limit integer DEFAULT '-1'::integer, p_before bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare docs jsonb; events jsonb; shape jsonb; result jsonb; pos jsonb; kind text; ordered_ids jsonb; values_json jsonb; evidence jsonb;
begin
 select coalesce(jsonb_object_agg(section,items),'{}') into docs from
  (select section,jsonb_object_agg(item_key,data) items from public.fueltech_pilot_documents
   where mode=p_mode and section not in ('pos_rows','pos_points') group by section) d;
 select coalesce(jsonb_agg(data order by sequence),'[]') into events from
  (select sequence,data from public.fueltech_pilot_audit where mode=p_mode and(p_before is null or sequence<p_before)
   order by sequence desc limit case when p_audit_limit<0 then null else p_audit_limit end) a;
 shape:=coalesce(docs->'shape','{}');
 result:=coalesce(docs->'root','{}')||jsonb_build_object('reports',coalesce(docs->'reports','{}'),'photos',coalesce(docs->'photos','{}'),'audit',events);
 if shape->>'pos'='null' then return result||jsonb_build_object('posRedemptionSync',null);end if;
 if shape->>'pos'='object' then
  pos:=coalesce(docs->'pos','{}');
  foreach kind in array array['rows','points'] loop
   if shape?kind then
    ordered_ids:=shape->kind;
    -- Keep the original array order without spooling every evidence document
    -- to a materialized CTE and then sorting the large joined rows on disk.
    select coalesce(jsonb_object_agg(item_key,data),'{}') into evidence
      from public.fueltech_pilot_documents where mode=p_mode and section='pos_'||kind;
    select coalesce(jsonb_agg(evidence->a.id order by a.ord),'[]') into values_json
      from jsonb_array_elements_text(ordered_ids) with ordinality a(id,ord)
      where evidence ? a.id;
    pos:=pos||jsonb_build_object(kind,values_json);
   end if;
  end loop;
  result:=result||jsonb_build_object('posRedemptionSync',pos);
 end if;
 return result;
end $function$
;
do $$ begin
 if exists(select 1 from pilot_io_preservation p where p.digest is distinct from md5(public.fueltech_pilot_load_v2(p.mode,100,null)::text)) then
  raise exception 'Disk IO optimization changed station records';
 end if;
end $$;
revoke all on function public.fueltech_pilot_assemble(text,integer,bigint) from public,anon,authenticated;
grant execute on function public.fueltech_pilot_assemble(text,integer,bigint) to service_role;
notify pgrst,'reload schema';
