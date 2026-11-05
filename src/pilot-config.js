const CONFIG_TIMEOUT_MS=15000;

export async function loadPilotConfiguration({signal,timeoutMs=CONFIG_TIMEOUT_MS}={}) {
  const controller=new AbortController();
  const cancelled=()=>Object.assign(new Error('Connection check cancelled.'),{name:'AbortError'});
  if(signal?.aborted)throw cancelled();
  let timer,onAbort;
  try {
    return await Promise.race([
      (async()=>{
        const response=await fetch('/api/pilot/config',{cache:'no-store',signal:controller.signal});
        const value=await response.json();
        if(!response.ok||!['live','shadow','disabled'].includes(value?.mode))throw new Error('Unable to check the station connection. Please retry.');
        return value;
      })(),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          reject(new Error('The station connection check took too long. Please retry.'));
          controller.abort();
        },timeoutMs);
        onAbort=()=>{reject(cancelled());controller.abort();};
        signal?.addEventListener('abort',onAbort,{once:true});
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',onAbort);
  }
}
