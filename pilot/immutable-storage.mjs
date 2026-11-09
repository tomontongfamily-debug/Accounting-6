import {createHash} from 'node:crypto';

// A retry must verify the existing bytes, never overwrite an accounting photo.
// Listing an exact filename avoids a failed GET for every new object and a
// duplicate INSERT for every already-completed upload.
const pending=new WeakMap();
export async function storeImmutable(db,bucketName,path,bytes,{contentType,metadata,verifyUpload=false,message}={}){
  const image=Buffer.from(bytes),sha256=createHash('sha256').update(image).digest('hex');
  let uploads=pending.get(db);
  if(!uploads){uploads=new Map();pending.set(db,uploads);}
  const key=JSON.stringify([bucketName,path]);
  const prior=uploads.get(key);
  if(prior){
    if(prior.sha256!==sha256)throw Object.assign(Error(message),{status:503});
    // Every caller still receives the verification guarantee it requested.
    await prior.promise;
    return storeImmutable(db,bucketName,path,image,{contentType,metadata,verifyUpload,message});
  }
  const save=async()=>{
    const bucket=db.storage.from(bucketName),split=path.lastIndexOf('/');
    const folder=split<0?'':path.slice(0,split),name=path.slice(split+1);
    const listed=await bucket.list(folder,{search:name,limit:100});
    if(listed.error)throw Object.assign(Error(message),{status:503});
    const exists=listed.data.some(file=>file.name===name);
    const uploaded=exists?null:await bucket.upload(path,image,{contentType,upsert:false,...(metadata?{metadata}:{})});
    // A simultaneous request on another server can win after our listing.
    // Even an uncertain upload is reusable only after byte-for-byte verification.
    if(exists||uploaded?.error||verifyUpload){
      const saved=await bucket.download(path);
      if(saved.error||!saved.data||!Buffer.from(await saved.data.arrayBuffer()).equals(image))throw Object.assign(Error(message),{status:503});
    }
    return {path,sha256,reused:exists||!!uploaded?.error};
  };
  const entry={sha256,promise:save()};uploads.set(key,entry);
  try{return await entry.promise;}finally{if(uploads.get(key)===entry)uploads.delete(key);}
}
