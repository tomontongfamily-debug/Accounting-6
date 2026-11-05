import {configuration} from './repository.mjs';
import {launchStatus} from './launch.mjs';

const entries=new WeakMap();
const CACHE_MS=5000,TIMEOUT_MS=10000;

// Only public routing metadata is shared briefly. Every accounting action still
// reads and validates configuration independently in the repository.
export async function publicConfiguration(db) {
  let entry=entries.get(db);
  if(!entry||Date.now()>=entry.expiresAt){
    const controller=new AbortController();let timer,stage='configuration';
    entry={expiresAt:Infinity};
    entry.promise=Promise.race([
      (async()=>{
        const config=await configuration(db,{signal:controller.signal});
        stage='launch';
        return {ok:true,...config,launch:await launchStatus(db,config,new Date(),{signal:controller.signal})};
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{
        reject(Object.assign(Error('Configuration check timed out.'),{code:'CONFIG_TIMEOUT'}));
        controller.abort();
      },TIMEOUT_MS);}),
    ]).then(value=>{entry.expiresAt=Date.now()+CACHE_MS;return value;})
      .catch(error=>{if(entries.get(db)===entry)entries.delete(db);throw Object.assign(error,{stage});})
      .finally(()=>clearTimeout(timer));
    entries.set(db,entry);
  }
  return structuredClone(await entry.promise);
}
