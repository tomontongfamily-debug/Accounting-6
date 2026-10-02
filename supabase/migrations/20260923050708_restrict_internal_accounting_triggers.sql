-- These are trigger functions, not browser RPC endpoints. Trigger execution is preserved.
revoke execute on function public.fueltech_touch_realtime_signal() from public,anon,authenticated;
revoke execute on function public.po_create_email_job() from public,anon,authenticated;
alter function public.po_touch_updated_at() set search_path='';
alter function public.po_create_email_job() set search_path='';
