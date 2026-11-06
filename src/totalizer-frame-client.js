let worker,nextId=0;
const pending=new Map();
const failure=(message,reason='worker-failed')=>Object.assign(new Error(message),{reason});
function stop(instance,error){
  if(!instance||worker!==instance)return;
  worker=undefined;instance.terminate();
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}
  pending.clear();
}
export function cancelTotalizerFrame(){
  stop(worker,failure('The image check took too long.','recognition-timeout'));
}
export function analyzeTotalizerFrame(pixels,width,height){
  if(typeof Worker==='undefined')return Promise.reject(failure('This browser cannot start the image reader.','unsupported-browser'));
  if(!worker){
    let instance;
    try{instance=new Worker(new URL('./totalizer-frame.worker.js',import.meta.url),{type:'module'});}
    catch{return Promise.reject(failure('This browser cannot start the image reader.','unsupported-browser'));}
    worker=instance;
    // A worker script can fail to load on weak/offline Wi-Fi even on a fully
    // capable phone. Treat that as retryable, not permanent incompatibility.
    instance.onerror=event=>{event.preventDefault?.();stop(instance,failure('The image reader could not start.','worker-failed'));};
    instance.onmessageerror=()=>stop(instance,failure('The image reader returned an unreadable response.'));
    instance.onmessage=({data:{id,gray,analysis,error}})=>{
      if(worker!==instance)return;
      const request=pending.get(id);if(!request)return;
      pending.delete(id);clearTimeout(request.timer);
      if(error){stop(instance,failure('The image could not be checked.'));request.reject(failure('The image could not be checked.'));}
      else request.resolve({gray,analysis});
    };
  }
  const instance=worker;
  return new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>stop(instance,failure('The image check took too long.','recognition-timeout')),15000);
    pending.set(id,{resolve,reject,timer});
    // Keep the caller's pixels intact for neural checks and failed-read recovery.
    try{instance.postMessage({id,pixels,width,height});}
    catch{stop(instance,failure('The image reader could not receive the photo.'));}
  });
}
