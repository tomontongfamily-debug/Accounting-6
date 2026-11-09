-- Expected optimistic contention is a retry result, not a database exception.
-- The original writer, revision guard, audit, receipts and historical checks
-- remain authoritative. This additive RPC also leaves old deployments working.
create function public.fueltech_pilot_try_commit_v2(
 p_mode text,p_revision bigint,p_mutation uuid,p_hash text,p_patch jsonb,p_result jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg public.fueltech_pilot_config; head_revision bigint; receipt public.fueltech_pilot_receipts; result jsonb;
begin
 select * into cfg from public.fueltech_pilot_config where branch='Liloan' for share;
 if cfg.mode is distinct from p_mode or cfg.mode='disabled' then raise exception 'Pilot configuration changed' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(43918,1);
 select * into receipt from public.fueltech_pilot_receipts where mode=p_mode and mutation_id=p_mutation;
 if found then
  if receipt.request_hash<>p_hash then raise exception 'Mutation ID reused with different data';end if;
  -- A replay did not commit a new revision. Do not acknowledge a revision newer
  -- than the caller's snapshot when returning a read projection.
  return jsonb_build_object('committed',true,'revision',p_revision,'result',receipt.result);
 end if;
 select revision into head_revision from public.fueltech_pilot_heads where mode=p_mode;
 if coalesce(head_revision,0)<>p_revision then
  return jsonb_build_object('committed',false,'revision',coalesce(head_revision,0));
 end if;
 result:=public.fueltech_pilot_commit_v2(p_mode,p_revision,p_mutation,p_hash,p_patch,p_result);
 return jsonb_build_object('committed',true,'revision',p_revision+1,'result',result);
end $$;
revoke all on function public.fueltech_pilot_try_commit_v2(text,bigint,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fueltech_pilot_try_commit_v2(text,bigint,uuid,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
