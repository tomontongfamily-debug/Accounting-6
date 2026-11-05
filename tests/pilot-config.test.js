import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPilotConfiguration} from '../src/pilot-config.js';

for(const phase of ['connection','response body']) {
  test(`configuration ${phase} timeout aborts the request and allows retry`,async t=>{
    const originalFetch=globalThis.fetch;let signal;
    t.mock.timers.enable({apis:['setTimeout']});
    globalThis.fetch=async(_url,options)=>{
      signal=options.signal;
      return phase==='connection'?new Promise(()=>{}):{ok:true,json:()=>new Promise(()=>{})};
    };
    try {
      const rejected=assert.rejects(loadPilotConfiguration(),/took too long/);
      await new Promise(resolve=>setImmediate(resolve));
      t.mock.timers.tick(15000);await rejected;assert.equal(signal.aborted,true);
      const config={mode:'live',start_date:'2026-10-03'};
      globalThis.fetch=async()=>({ok:true,json:async()=>config});
      assert.deepEqual(await loadPilotConfiguration(),config);
    }finally{globalThis.fetch=originalFetch;t.mock.timers.reset();}
  });
}

test('configuration check cancels on unmount even if fetch ignores abort',async()=>{
  const originalFetch=globalThis.fetch,controller=new AbortController();let signal;
  globalThis.fetch=async(_url,options)=>{signal=options.signal;return new Promise(()=>{});};
  try {
    const rejected=assert.rejects(loadPilotConfiguration({signal:controller.signal}),{name:'AbortError'});
    controller.abort();await rejected;assert.equal(signal.aborted,true);
  }finally{globalThis.fetch=originalFetch;}
});

test('configuration check rejects unsuccessful and malformed responses, and honors disabled mode',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    for(const response of [{ok:false,json:async()=>({error:'Unavailable'})},{ok:true,json:async()=>({})}]) {
      globalThis.fetch=async()=>response;
      await assert.rejects(loadPilotConfiguration(),/Unable to check/);
    }
    globalThis.fetch=async()=>({ok:true,json:async()=>({mode:'disabled'})});
    assert.equal((await loadPilotConfiguration()).mode,'disabled');
  }finally{globalThis.fetch=originalFetch;}
});
