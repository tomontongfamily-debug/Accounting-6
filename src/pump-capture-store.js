// Device-local recovery only. Photos and OCR results are never placed in the
// public reader cache. A restored capture still needs current server revision
// checks and a cashier confirmation before it can become an official reading.
const DATABASE='fueltech-pump-captures-v1', STORE='captures';
let opening;
function database(){
  if(!globalThis.indexedDB)return Promise.resolve(null);
  return opening||=new Promise(resolve=>{
    let settled=false;
    const timer=setTimeout(()=>finish(null),1500);
    function finish(result){if(settled){result?.close();return;}settled=true;clearTimeout(timer);if(!result)opening=undefined;resolve(result);}
    let request;
    try{request=indexedDB.open(DATABASE,1);}catch{finish(null);return;}
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>finish(request.result);
    request.onerror=()=>finish(null);
    request.onblocked=()=>finish(null);
  });
}
export function captureKey(report,row,change){
  return JSON.stringify([globalThis.window?.__fueltechPilotConfig?.mode||'unknown',report.branch,report.date,report.shiftId,row.id,change?.id||'',change?.effectiveTime||'']);
}
async function transact(key,action,value,expectedMutation){
  const db=await database();if(!db)return null;
  return new Promise(resolve=>{
    let settled=false;
    const timer=setTimeout(()=>finish(null),1500);
    function finish(result){if(settled)return;settled=true;clearTimeout(timer);resolve(result);}
    try{
      const transaction=db.transaction(STORE,action==='get'?'readonly':'readwrite');
      const store=transaction.objectStore(STORE);
      const request=expectedMutation?store.get(key):store[action](...(action==='put'?[value,key]:[key]));
      let matched=!expectedMutation;
      if(expectedMutation)request.onsuccess=()=>{
        if(request.result?.photoMutationId!==expectedMutation)return;
        matched=true;store[action](...(action==='put'?[value,key]:[key]));
      };
      transaction.oncomplete=()=>finish(expectedMutation?matched:request.result??true);
      transaction.onerror=()=>finish(null);transaction.onabort=()=>finish(null);
    }catch{finish(null);}
  });
}
export async function keepPumpCapture(key,capture,{onlyIfCurrent=false}={}){
  const value={savedAt:Date.now()};
  for(const field of ['data','sourceRow','expectedRevision','photoMutationId','saved','photoSaveMs','photoInput','photoInputFinalized','readingInput','readingOptions','result','startedAtMs','captureToReadingMs'])if(capture[field]!==undefined)value[field]=capture[field];
  return transact(key,'put',JSON.parse(JSON.stringify(value)),onlyIfCurrent?capture.photoMutationId:undefined);
}
export async function readPumpCapture(key){
  const value=await transact(key,'get');
  if(!value||typeof value!=='object'||!value.data||!value.photoMutationId)return null;
  return value;
}
export async function forgetPumpCapture(key,expectedMutation){return transact(key,'delete',undefined,expectedMutation);}
