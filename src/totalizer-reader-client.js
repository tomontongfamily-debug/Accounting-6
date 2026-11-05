import { readTotalizerGrid } from './totalizer-grid.js';
import { prepareReaderFiles } from './ocr-downloads.js';

let worker,nextId=0,preparation;
const pending=new Map();
function stopWorker(){
  worker?.terminate();worker=undefined;preparation=undefined;
  for(const request of pending.values()){
    clearTimeout(request.timer);request.reject(Error('The automatic reader stopped. Please retry.'));
  }
  pending.clear();
}
async function request(operation,args){
  if(typeof Worker==='undefined'){
    if(operation==='grid')return readTotalizerGrid(...args);
    const neural=await import('./totalizer-neural.js');
    if(operation==='prepare'){await neural.prepareNeuralTotalizer(args[0]);return true;}
    return neural.neuralTotalizerCandidates(...args);
  }
  if(!worker){
    worker=new Worker(new URL('./totalizer-reader.worker.js',import.meta.url),{type:'module'});
    worker.onerror=stopWorker;worker.onmessageerror=stopWorker;
    worker.onmessage=({data:{id,result,error}})=>{
      const entry=pending.get(id);if(!entry)return;
      pending.delete(id);clearTimeout(entry.timer);
      if(error){stopWorker();entry.reject(Error('The automatic reader could not check the display.'));}
      else entry.resolve(result);
    };
  }
  return new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(stopWorker,30000);
    pending.set(id,{resolve,reject,timer});
    // Copy rather than transfer: cached model buffers and the original photo
    // must remain usable after a failed worker or a retry.
    try{worker.postMessage({id,operation,args});}catch{stopWorker();}
  });
}
export const readTotalizerGridAsync=(...args)=>request('grid',args);
export function prepareAdvancedTotalizer(){
  // Download/integrity checking finishes before the worker's CPU-init clock.
  // Pass those verified bytes so private browsers need no second download.
  preparation ||= prepareReaderFiles().then(files=>request('prepare',[files])).catch(error=>{preparation=undefined;throw error;});
  return preparation;
}
export async function neuralTotalizerCandidatesAsync(...args){
  await prepareAdvancedTotalizer();
  return request('neural',args);
}
