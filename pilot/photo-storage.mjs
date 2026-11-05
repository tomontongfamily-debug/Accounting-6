import {createHash} from 'node:crypto';
import {backupImmutable} from './backup.mjs';

export async function persistPumpPhoto(db,path,image,context,archive=backupImmutable){
  // Preserve validated report/nozzle provenance with the original bytes. If a
  // later station commit fails, this private object remains identifiable.
  const metadata={...context,sha256:createHash('sha256').update(image).digest('hex')};
  const uploaded=await db.storage.from('fueltech-pilot-photos').upload(path,image,{contentType:'image/jpeg',upsert:false,metadata});
  if(uploaded.error){
    const existing=await db.storage.from('fueltech-pilot-photos').download(path);
    if(existing.error||!Buffer.from(await existing.data.arrayBuffer()).equals(image))throw Object.assign(Error('Photo could not be saved. Retry saving the kept capture.'),{status:503});
  }
  await archive('photos/'+path,image);
}
