-- Keep occasional busy-period reads within the client's 30-second deadline
-- without changing timeout settings for other applications or database roles.
alter function public.fueltech_pilot_load_compact(text,integer,bigint) set statement_timeout='15s';
alter function public.fueltech_pilot_load_v2(text,integer,bigint) set statement_timeout='15s';
notify pgrst,'reload schema';
