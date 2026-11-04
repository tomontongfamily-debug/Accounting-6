import { backupImmutable, backupJson } from './backup.mjs';

export async function archiveRecovery(db,backupDate,archive=backupImmutable){
 const archives=[];
 const heads=await db.from('fueltech_pilot_heads').select('mode,revision');
 if(heads.error)throw Error('Recovery revisions could not be verified.');
 for(const head of heads.data){
  const baseline=await db.from('fueltech_pilot_state_legacy').select('mode,revision,data,updated_at').eq('mode',head.mode).maybeSingle();
  if(baseline.error)throw Error('Recovery baseline could not be verified.');
  if(baseline.data)archives.push(await backupJson(`journals/baselines/${head.mode}/${baseline.data.revision}.json`,{schemaVersion:2,baseline:baseline.data},archive));
  const checkpoint=await db.rpc('fueltech_pilot_checkpoint',{p_mode:head.mode});
  if(checkpoint.error)throw Error('Recovery checkpoint could not be verified.');
  let cursor=0;
  for(;;){
   const page=await db.from('fueltech_pilot_journal').select('mode,revision,patch,created_at').eq('mode',head.mode).gt('revision',cursor).lte('revision',head.revision).gte('created_at',backupDate+'T00:00:00+08:00').order('revision').limit(100);
   if(page.error)throw Error('Recovery journal could not be verified.');
   if(!page.data.length)break;
   const next=page.data.at(-1).revision;
   if(next<=cursor)throw Error('Recovery journal pagination did not advance.');
   cursor=next;
   archives.push(await backupJson(`journals/${backupDate}/${head.mode}/${cursor}.json`,{schemaVersion:2,entries:page.data},archive));
  }
 }
 return archives;
}
