-- Reconstruct ordered POS evidence directly from indexed documents instead of
-- building a large JSON object and then parsing that object back into rows.
-- This also gives PostgREST a function boundary: its aggregate query must not
-- inline/re-evaluate the document reconstruction for each expression.
set lock_timeout='5s';
select pg_advisory_xact_lock(43918,1);
create temporary table liloan_read_preservation on commit drop as
  select mode,md5(string_agg(section||':'||item_key||':'||md5(data::text),'|' order by section,item_key)) digest
  from public.fueltech_pilot_documents group by mode;

create or replace function public.fueltech_pilot_join_docs(p_docs jsonb,p_audit jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb; shape jsonb:=coalesce(p_docs->'shape','{}'); pos jsonb; kind text; items jsonb; ordered_ids jsonb; values_json jsonb;
begin
 result:=coalesce(p_docs->'root','{}')||jsonb_build_object('reports',coalesce(p_docs->'reports','{}'),'photos',coalesce(p_docs->'photos','{}'),'audit',p_audit);
 if shape->>'pos'='null' then return result||jsonb_build_object('posRedemptionSync',null);end if;
 if shape->>'pos'='object' then
  pos:=coalesce(p_docs->'pos','{}');
  foreach kind in array array['rows','points'] loop
   if shape?kind then
    -- Extract each large input once, outside the set-returning query.
    items:=coalesce(p_docs->('pos_'||kind),'{}');ordered_ids:=shape->kind;
    select coalesce(jsonb_agg(e.value order by a.ord),'[]') into values_json
     from jsonb_each(items) e join jsonb_array_elements_text(ordered_ids) with ordinality a(id,ord) on a.id=e.key;
    pos:=pos||jsonb_build_object(kind,values_json);
   end if;
  end loop;
  result:=result||jsonb_build_object('posRedemptionSync',pos);
 end if;
 return result;
end $$;

create or replace function public.fueltech_pilot_assemble(p_mode text,p_audit_limit integer default -1,p_before bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare docs jsonb; events jsonb; shape jsonb; result jsonb; pos jsonb; kind text; ordered_ids jsonb; values_json jsonb;
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
    select coalesce(jsonb_agg(d.data order by a.ord),'[]') into values_json
     from jsonb_array_elements_text(ordered_ids) with ordinality a(id,ord)
     join public.fueltech_pilot_documents d on d.mode=p_mode and d.section='pos_'||kind and d.item_key=a.id;
    pos:=pos||jsonb_build_object(kind,values_json);
   end if;
  end loop;
  result:=result||jsonb_build_object('posRedemptionSync',pos);
 end if;
 return result;
end $$;

-- Calls made by the REST layer remain bounded to 100 audit events; the legacy
-- view and backup exports still reconstruct all events, in their original order.
create or replace function public.fueltech_pilot_load_v2(p_mode text,p_audit_limit integer default 0,p_before bigint default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare head public.fueltech_pilot_heads; state jsonb; audit_cursor bigint;
begin
 select * into head from public.fueltech_pilot_heads where mode=p_mode;
 if head.mode is null then return null;end if;
 state:=public.fueltech_pilot_assemble(p_mode,least(greatest(p_audit_limit,0),100),p_before);
 if p_audit_limit>0 then
  select min(sequence) into audit_cursor from
   (select sequence from public.fueltech_pilot_audit where mode=p_mode and(p_before is null or sequence<p_before)
    order by sequence desc limit least(p_audit_limit,100)) a;
 end if;
 return jsonb_build_object('revision',head.revision,'data',state,'auditCursor',audit_cursor);
end $$;

do $$ begin
 if exists(select 1 from liloan_read_preservation p join
  (select mode,md5(string_agg(section||':'||item_key||':'||md5(data::text),'|' order by section,item_key)) digest
   from public.fueltech_pilot_documents group by mode) d using(mode) where p.digest<>d.digest) then
  raise exception 'Read optimization changed saved documents';
 end if;
end $$;
revoke all on function public.fueltech_pilot_join_docs(jsonb,jsonb),public.fueltech_pilot_assemble(text,integer,bigint),public.fueltech_pilot_load_v2(text,integer,bigint) from public,anon,authenticated;
grant execute on function public.fueltech_pilot_join_docs(jsonb,jsonb),public.fueltech_pilot_assemble(text,integer,bigint),public.fueltech_pilot_load_v2(text,integer,bigint) to service_role;
notify pgrst,'reload schema';
