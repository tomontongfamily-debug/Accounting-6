-- Apply only to the CV project ncmptgqsumxgardylnhc, not the Accounting project.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fueltech-accounting-backups','fueltech-accounting-backups',false,10485760,array['image/jpeg','application/json'])
on conflict(id) do nothing;
-- Protect this bucket even if another application has a broad permissive policy.
create policy fueltech_accounting_backups_server_only on storage.objects
as restrictive for all to public
using(bucket_id<>'fueltech-accounting-backups')
with check(bucket_id<>'fueltech-accounting-backups');
