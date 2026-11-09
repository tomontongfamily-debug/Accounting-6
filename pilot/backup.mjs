import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {storeImmutable} from './immutable-storage.mjs';
export const BACKUP_BUCKET='fueltech-accounting-backups';
export function backupDatabase(){
 if(!process.env.FUELTECH_CV_URL||!process.env.FUELTECH_CV_SERVICE_ROLE_KEY)throw Error('The independent backup connection is not configured.');
 return createClient(process.env.FUELTECH_CV_URL,process.env.FUELTECH_CV_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function backupImmutable(path,bytes,contentType='image/jpeg',db=backupDatabase()){
 return storeImmutable(db,BACKUP_BUCKET,path,bytes,{contentType,verifyUpload:true,message:'The backup copy could not be verified. Retry the same save.'});
}

// The independent bucket accepts JSON/JPEG and caps each object at 10 MiB.
// A 6 MiB compressed part fits as a base64 JSON envelope below that limit.
export async function backupJson(path,value,archive=backupImmutable,{maxPartBytes=6*1024*1024}={}){
 if(!Number.isSafeInteger(maxPartBytes)||maxPartBytes<1||maxPartBytes>6*1024*1024)throw Error('Invalid backup part size.');
 const raw=Buffer.from(JSON.stringify(value)),compressed=gzipSync(raw);
 const details={encoding:'gzip-base64',uncompressedBytes:raw.length,uncompressedSha256:createHash('sha256').update(raw).digest('hex'),compressedBytes:compressed.length,compressedSha256:createHash('sha256').update(compressed).digest('hex')};
 const upload=(name,bytes)=>archive(name,Buffer.from(JSON.stringify({schemaVersion:1,encoding:'gzip-base64',data:bytes.toString('base64')})),'application/json');
 if(compressed.length<=maxPartBytes)return {...await upload(path+'.gzip.json',compressed),...details};
 const parts=[];
 for(let offset=0;offset<compressed.length;offset+=maxPartBytes){
  const part=compressed.subarray(offset,offset+maxPartBytes);
  parts.push({...await upload(`${path}.parts/${String(parts.length+1).padStart(4,'0')}.json`,part),bytes:part.length});
 }
 const manifest={schemaVersion:1,...details,parts};
 return {...await archive(path+'.manifest.json',Buffer.from(JSON.stringify(manifest)),'application/json'),...details,parts};
}
