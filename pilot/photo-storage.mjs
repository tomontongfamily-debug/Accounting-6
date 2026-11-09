import {createHash} from 'node:crypto';
import {backupImmutable} from './backup.mjs';
import {storeImmutable} from './immutable-storage.mjs';

export async function persistPumpPhoto(db,path,image,context,archive=backupImmutable){
  // Preserve validated report/nozzle provenance with the original bytes. If a
  // later station commit fails, this private object remains identifiable.
  const metadata={...context,sha256:createHash('sha256').update(image).digest('hex')};
  await storeImmutable(db,'fueltech-pilot-photos',path,image,{contentType:'image/jpeg',metadata,message:'Photo could not be saved. Retry saving the kept capture.'});
  await archive('photos/'+path,image);
}
