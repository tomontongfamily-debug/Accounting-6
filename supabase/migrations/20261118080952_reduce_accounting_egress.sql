-- Server-only reads. Existing canonical records, writers and recovery history
-- stay authoritative; an expired cache cursor always falls back to a full read.
create function public.fueltech_pilot_load_delta(p_mode text,p_since bigint)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='15s' as $$
declare current_revision bigint; floor_revision bigint; upserts jsonb; removals jsonb;
begin
 select h.revision into current_revision from public.fueltech_pilot_heads h where mode=p_mode;
 if current_revision is null then return null;end if;
 select coalesce(min(j.revision)-1,current_revision) into floor_revision from public.fueltech_pilot_journal j where mode=p_mode;
 if p_since is null or p_since<floor_revision or p_since>current_revision then
  return jsonb_build_object('full',true,'revision',current_revision);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('section',section,'key',item_key,'data',data)),'[]') into upserts
 from public.fueltech_pilot_documents where mode=p_mode and changed_revision>p_since and changed_revision<=current_revision
 and section not in ('pos_rows','pos_points') and not(section='shape' and item_key in ('rows','points'));
 select coalesce(jsonb_agg(distinct r.item),'[]') into removals
 from public.fueltech_pilot_journal j cross join lateral jsonb_array_elements(j.patch->'removals') r(item)
 where j.mode=p_mode and j.revision>p_since and j.revision<=current_revision
 and r.item->>'section' not in ('pos_rows','pos_points')
 and not(r.item->>'section'='shape' and r.item->>'key' in ('rows','points'))
 and not exists(select 1 from public.fueltech_pilot_documents d where d.mode=p_mode and d.section=r.item->>'section' and d.item_key=r.item->>'key');
 return jsonb_build_object('full',false,'revision',current_revision,'upserts',upserts,'removals',removals);
end $$;

-- Load only evidence for changed business dates. Full ID order is retained so
-- the ordinary atomic document writer preserves all evidence outside the window.
create function public.fueltech_pilot_load_pos_window(p_mode text,p_dates text[] default null)
returns jsonb language sql stable security invoker set search_path='' set statement_timeout='15s' as $$
 select jsonb_build_object('revision',h.revision,'data',
  coalesce((select jsonb_object_agg(item_key,data) from public.fueltech_pilot_documents where mode=p_mode and section='pos'),'{}')
  ||jsonb_build_object('rows',coalesce((select jsonb_agg(data order by item_key) from public.fueltech_pilot_documents where mode=p_mode and section='pos_rows' and(p_dates is null or data->>'date'=any(p_dates))),'[]'),
   'points',coalesce((select jsonb_agg(data order by item_key) from public.fueltech_pilot_documents where mode=p_mode and section='pos_points' and(p_dates is null or data->>'date'=any(p_dates))),'[]'))
  ||case when p_dates is null then '{}'::jsonb else jsonb_build_object('_window',jsonb_build_object('dates',to_jsonb(p_dates),
   'order',coalesce((select jsonb_object_agg(item_key,data) from public.fueltech_pilot_documents where mode=p_mode and section='shape' and item_key in ('rows','points')),'{}'),
   'loaded',jsonb_build_object(
    'rows',coalesce((select jsonb_agg(item_key order by item_key) from public.fueltech_pilot_documents where mode=p_mode and section='pos_rows' and data->>'date'=any(p_dates)),'[]'),
    'points',coalesce((select jsonb_agg(item_key order by item_key) from public.fueltech_pilot_documents where mode=p_mode and section='pos_points' and data->>'date'=any(p_dates)),'[]')))) end)
 from public.fueltech_pilot_heads h where mode=p_mode;
$$;
revoke all on function public.fueltech_pilot_load_delta(text,bigint),public.fueltech_pilot_load_pos_window(text,text[]) from public,anon,authenticated;
grant execute on function public.fueltech_pilot_load_delta(text,bigint),public.fueltech_pilot_load_pos_window(text,text[]) to service_role;
notify pgrst,'reload schema';
