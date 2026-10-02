import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
export const BACKUP_BUCKET='fueltech-accounting-backups';
export function backupDatabase(){
 if(!process.env.FUELTECH_CV_URL||!process.env.FUELTECH_CV_SERVICE_ROLE_KEY)throw Error('The independent backup connection is not configured.');
 return createClient(process.env.FUELTECH_CV_URL,process.env.FUELTECH_CV_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function backupImmutable(path,bytes,contentType='image/jpeg',db=backupDatabase()){
 const bucket=db.storage.from(BACKUP_BUCKET);
 const result=await bucket.upload(path,bytes,{contentType,upsert:false});
 // Verify a copy even after successful upload, and reuse only identical retries.
 const saved=await bucket.download(path);
 if(saved.error||!Buffer.from(await saved.data.arrayBuffer()).equals(Buffer.from(bytes))) throw Object.assign(Error('The backup copy could not be verified. Retry the same save.'),{status:503});
 return {path,sha256:createHash('sha256').update(bytes).digest('hex'),reused:!!result.error};
}
