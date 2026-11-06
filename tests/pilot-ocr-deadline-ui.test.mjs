import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {totalizerDisplayFixture} from './totalizer-display-fixture.mjs';

function primaryWorkerFixture(mode){
 const NativeWorker=globalThis.Worker;
 globalThis.__primaryWorkers=[];globalThis.__unhandled=[];
 addEventListener('unhandledrejection',event=>{globalThis.__unhandled.push(String(event.reason));event.preventDefault();});
 globalThis.Worker=class{
  constructor(url,options){
   if(!String(url).includes('/worker.min.js')||globalThis.__primaryWorkers.length)return new NativeWorker(url,options);
   this.calls=[];this.terminations=0;globalThis.__primaryWorkers.push(this);
  }
  postMessage(message){
   this.calls.push(message);
   if(mode==='hold-init'||mode==='hold-recognize'&&message.action==='recognize')return;
   const status=mode==='reject-init'&&message.action==='loadLanguage'?'reject':'resolve';
   queueMicrotask(()=>this.onmessage?.({data:{...message,status,data:message.action==='recognize'?{text:'',confidence:0,blocks:[]}:undefined}}));
  }
  terminate(){this.terminations++;}
 };
}

test('primary protocol is compatible, startup and recognition are bounded, and old jobs cannot block or overwrite recovery',async()=>{
 const server=await createServer({cacheDir:'node_modules/.vite-ocr-deadline-test',server:{host:'127.0.0.1',port:0}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`,errors=[];
 async function pageFor(mode){
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  if(mode)await page.addInitScript(primaryWorkerFixture,mode);
  else await page.addInitScript(()=>{globalThis.__unhandled=[];addEventListener('unhandledrejection',e=>{globalThis.__unhandled.push(String(e.reason));e.preventDefault();});});
  await page.goto(origin+'/ocr/neural/README.md');
  if(mode)await page.evaluate(async()=>{await(await import('/src/ocr-downloads.js')).preparePrimaryReaderFiles();});
  return page;
 }
 try{
  const protocol=await pageFor('protocol');
  const calls=await protocol.evaluate(async()=>{
   const {createPrimaryTotalizer}=await import('/src/totalizer-primary-client.js');
   const session=createPrimaryTotalizer();await session.ready;
   await session.setParameters({tessedit_pageseg_mode:'7'});
   const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
   await session.recognize(canvas,{}, {text:true,blocks:true});
   const native=globalThis.__primaryWorkers[0],messages=native.calls;
   session.terminate();
   return {actions:messages.map(x=>x.action),load:messages[0].payload,language:messages[1].payload,initialize:messages[2].payload,
    languageCode:messages[1].payload.langs[0].code,languageBytes:messages[1].payload.langs[0].data.byteLength,
    output:messages.at(-1).payload.output,png:[...messages.at(-1).payload.image.slice(0,8)],terminations:native.terminations,unhandled:globalThis.__unhandled};
  });
  assert.deepEqual(calls.actions,['load','loadLanguage','initialize','setParameters','setParameters','recognize']);
  assert.equal(calls.load.options.lstmOnly,true);assert.equal(calls.languageCode,'ssd_int');assert.ok(calls.languageBytes>=1302536);assert.equal(calls.language.options.gzip,true);
  assert.deepEqual(calls.initialize,{langs:'ssd_int',oem:1,config:{}});assert.deepEqual(calls.output,{text:true,blocks:true});
  assert.deepEqual(calls.png,[137,80,78,71,13,10,26,10]);assert.equal(calls.terminations,1);assert.deepEqual(calls.unhandled,[]);await protocol.close();

  for(const mode of ['hold-init','reject-init']){
   const page=await pageFor(mode),data=await page.evaluate(totalizerDisplayFixture,{text:'234567.89'});
   const result=await page.evaluate(async({data,mode})=>{
    const {detectTotalizerResult}=await import('/src/totalizer-ocr.js');
    const first=await detectTotalizerResult(data,{timeoutMs:3000,initializationTimeoutMs:120});
    const old=globalThis.__primaryWorkers[0],before=old.calls.length;
    // A late successful load reply from the terminated worker must do nothing.
    old.onmessage({data:{...old.calls[0],status:'resolve',data:{}}});
    const next=await detectTotalizerResult(data);
    await new Promise(resolve=>setTimeout(resolve,20));
    return {first,next,before,after:old.calls.length,terminations:old.terminations,unhandled:globalThis.__unhandled};
   },{data,mode});
   assert.equal(result.first.reading,null);assert.equal(result.first.attempt.status,'error');
   assert.equal(result.first.attempt.reason,mode==='hold-init'?'initialization-timeout':'worker-failed');
   assert.equal(result.next.reading,234567.89);assert.equal(result.before,result.after);assert.equal(result.terminations,1);assert.deepEqual(result.unhandled,[]);await page.close();
  }

  const queued=await pageFor('hold-recognize'),data=await queued.evaluate(totalizerDisplayFixture,{text:'234567.89'});
  const recovery=await queued.evaluate(async data=>{
   const {detectTotalizerResult}=await import('/src/totalizer-ocr.js');
   const first=detectTotalizerResult(data,{timeoutMs:1200});
   const expired=await detectTotalizerResult(data,{timeoutMs:250});
   const old=globalThis.__primaryWorkers[0],stillActive=old.terminations===0;
   const next=detectTotalizerResult(data);
   const firstResult=await first;
   const held=old.calls.find(x=>x.action==='recognize');
   if(held)old.onmessage({data:{...held,status:'resolve',data:{text:'999999.99',confidence:100,blocks:[]}}});
   const nextResult=await next;
   return {expired,stillActive,first:firstResult,next:nextResult,terminations:old.terminations,unhandled:globalThis.__unhandled};
  },data);
  assert.equal(recovery.expired.attempt.reason,'recognition-timeout');assert.equal(recovery.stillActive,true,'A queued expiry cannot terminate the active photo');
  assert.equal(recovery.first.attempt.reason,'recognition-timeout');assert.equal(recovery.next.reading,234567.89);
  assert.equal(recovery.terminations,1);assert.deepEqual(recovery.unhandled,[]);await queued.close();

  const dead=await pageFor(),deadData=await dead.evaluate(totalizerDisplayFixture,{text:'234567.89'});
  const deadResult=await dead.evaluate(async data=>{
   const {prepareTotalizer,detectTotalizerResult}=await import('/src/totalizer-ocr.js');
   const session=await prepareTotalizer();session.worker.terminate();
   const first=await detectTotalizerResult(data,{timeoutMs:300});
   const next=await detectTotalizerResult(data);
   return {first,next,unhandled:globalThis.__unhandled};
  },deadData);
  assert.equal(deadResult.first.attempt.reason,'recognition-timeout');assert.equal(deadResult.next.reading,234567.89);assert.deepEqual(deadResult.unhandled,[]);await dead.close();

  const background=await pageFor();let downloads=0;
  await background.route('**/worker.min.js',async route=>{downloads++;await new Promise(resolve=>setTimeout(resolve,700));await route.continue();});
  const backgroundData=await background.evaluate(totalizerDisplayFixture,{text:'234567.89'});
  const prepared=await background.evaluate(async data=>{
   const {analyzeTotalizerFrame}=await import('/src/totalizer-frame-client.js');
   await analyzeTotalizerFrame(new Uint8ClampedArray(4),1,1);
   const {prepareTotalizer,detectTotalizerResult}=await import('/src/totalizer-ocr.js');
   const preparing=prepareTotalizer({timeoutMs:5000});
   const expired=await detectTotalizerResult(data,{timeoutMs:200});
   const original=await preparing;
   const reused=await prepareTotalizer();
   const next=await detectTotalizerResult(data);
   return {expired,sameSession:original===reused,closed:original.closed,next,unhandled:globalThis.__unhandled};
  },backgroundData);
  assert.equal(prepared.expired.attempt.reason,'recognition-timeout');assert.equal(prepared.sameSession,true);assert.equal(prepared.closed,false);
  assert.equal(prepared.next.reading,234567.89);assert.equal(downloads,1,'A photo deadline must not keep restarting the background download');assert.deepEqual(prepared.unhandled,[]);await background.close();

  const frame=await pageFor();
  await frame.evaluate(()=>{
   const NativeWorker=globalThis.Worker;globalThis.__frameWorkers=[];
   globalThis.Worker=class{
    constructor(url,options){if(!String(url).includes('totalizer-frame.worker.js')||globalThis.__frameWorkers.length)return new NativeWorker(url,options);this.terminations=0;globalThis.__frameWorkers.push(this);}
    postMessage(data){this.message=data;}
    terminate(){this.terminations++;}
   };
  });
  const frameData=await frame.evaluate(totalizerDisplayFixture,{text:'234567.89'});
  const frameRecovery=await frame.evaluate(async data=>{
   const {detectTotalizerResult}=await import('/src/totalizer-ocr.js');
   let ticks=0;const timer=setInterval(()=>ticks++,10);
   const expired=await detectTotalizerResult(data,{timeoutMs:300});clearInterval(timer);
   const old=globalThis.__frameWorkers[0],next=detectTotalizerResult(data);
   old.onmessage({data:{id:old.message.id,error:true}});
   return {expired,next:await next,ticks,terminations:old.terminations,unhandled:globalThis.__unhandled};
  },frameData);
  assert.equal(frameRecovery.expired.attempt.reason,'recognition-timeout');assert.equal(frameRecovery.next.reading,234567.89);
  assert.ok(frameRecovery.ticks>=2);assert.equal(frameRecovery.terminations,1);assert.deepEqual(frameRecovery.unhandled,[]);await frame.close();

  const unsupported=await pageFor();
  await unsupported.evaluate(()=>{globalThis.Worker=undefined;});
  const unsupportedData=await unsupported.evaluate(totalizerDisplayFixture,{text:'234567.89'});
  const unsupportedResult=await unsupported.evaluate(async data=>{
   const {detectTotalizerResult,detectTotalizer}=await import('/src/totalizer-ocr.js');
   const result=await detectTotalizerResult(data);
   let thrown;try{await detectTotalizer(data);}catch(error){thrown=error.reason;}
   return {result,thrown,unhandled:globalThis.__unhandled};
  },unsupportedData);
  assert.equal(unsupportedResult.result.attempt.reason,'unsupported-browser');assert.equal(unsupportedResult.thrown,'unsupported-browser');assert.deepEqual(unsupportedResult.unhandled,[]);await unsupported.close();

  const failed=await pageFor('protocol');
  const failedRpc=await failed.evaluate(async()=>{
   const {createPrimaryTotalizer}=await import('/src/totalizer-primary-client.js');
   const session=createPrimaryTotalizer();await session.ready;
   const pending=session.setParameters({tessedit_pageseg_mode:'7'});
   session.worker.onerror({preventDefault(){}});
   let reason;try{await pending;}catch(error){reason=error.reason;}
   await new Promise(resolve=>setTimeout(resolve,20));
   return {reason,closed:session.closed,terminations:globalThis.__primaryWorkers[0].terminations,unhandled:globalThis.__unhandled};
  });
  assert.equal(failedRpc.reason,'worker-failed');assert.equal(failedRpc.closed,true);assert.equal(failedRpc.terminations,1);assert.deepEqual(failedRpc.unhandled,[]);await failed.close();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
