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
  // A fixed head bounds an immutable row set, so these small offset pages can
  // be read together. Three 25-row pages use less memory than one old 100-row
  // batch and overlap network waits without exhausting the function runtime.
  const pageSize=25,concurrency=3;
  for(let offset=0;;offset+=pageSize*concurrency){
   const pages=await Promise.all(Array.from({length:concurrency},(_,i)=>{
    const start=offset+i*pageSize;
    return db.from('fueltech_pilot_journal').select('mode,revision,patch,created_at').eq('mode',head.mode).lte('revision',head.revision).gte('created_at',backupDate+'T00:00:00+08:00').order('revision').range(start,start+pageSize-1);
   }));
   if(pages.some(page=>page.error))throw Error('Recovery journal could not be verified.');
   const saved=await Promise.all(pages.filter(page=>page.data.length).map(page=>backupJson(
    `journals/${backupDate}/${head.mode}/${page.data[0].revision}-${page.data.at(-1).revision}.json`,
    {schemaVersion:2,entries:page.data},archive)));
   archives.push(...saved);
   if(pages.some(page=>page.data.length<pageSize))break;
  }
 }
 return archives;
}
