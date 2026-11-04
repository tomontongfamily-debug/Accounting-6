-- Clients whose cursor predates retained recovery history must reload all
-- reports. An empty journal result is not evidence that nothing changed.
CREATE OR REPLACE FUNCTION public.fueltech_pilot_changes_v2(p_mode text,p_since bigint,p_through bigint)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' AS $function$
 SELECT CASE WHEN p_since < COALESCE(
   (SELECT min(revision)-1 FROM public.fueltech_pilot_journal WHERE mode=p_mode),
   (SELECT revision FROM public.fueltech_pilot_heads WHERE mode=p_mode),0)
 THEN jsonb_build_object('full',true,'keys','[]'::jsonb)
 ELSE (
   SELECT jsonb_build_object('full',coalesce(bool_or(section NOT IN ('reports','photos')),false),
     'keys',coalesce(jsonb_agg(DISTINCT key) FILTER(WHERE section='reports'),'[]'))
   FROM (SELECT c->>'section' AS section,c->>'key' AS key
     FROM public.fueltech_pilot_journal j
     CROSS JOIN LATERAL jsonb_array_elements((j.patch->'upserts')||(j.patch->'removals')) c
     WHERE j.mode=p_mode AND j.revision>p_since AND j.revision<=p_through) changes
 ) END;
$function$;
