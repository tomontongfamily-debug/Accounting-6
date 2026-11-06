import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {totalizerDisplayFixture} from './totalizer-display-fixture.mjs';

test('prepared primary reader survives reload with all OCR asset requests blocked and returns bounded accurate suggestions',async()=>{
 const deployment=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url)));
 const policy=deployment.headers.flatMap(rule=>rule.headers).find(header=>header.key==='Content-Security-Policy').value;
 const server=await createServer({cacheDir:'node_modules/.vite-primary-offline',server:{host:'127.0.0.1',port:0,headers:{'Content-Security-Policy':policy}}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`,page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));let blockedRequests=0;
 try{
  await page.goto(origin+'/ocr/neural/README.md');
  await page.evaluate(async()=>{await Promise.all([(await import('/src/totalizer-ocr.js')).prepareTotalizer(),(await import('/src/totalizer-reader-client.js')).prepareAdvancedTotalizer()]);});
  await page.reload();
  await page.route('**/ocr/lcd-neural-3-20261104/**',route=>{blockedRequests++;return route.abort();});
  await page.evaluate(async()=>{await Promise.all([(await import('/src/totalizer-ocr.js')).prepareTotalizer(),(await import('/src/totalizer-reader-client.js')).prepareAdvancedTotalizer()]);});
  const timings=[];
  for(const [text,expected]of [['234567.89',234567.89],['1234567.89',1234567.89]]){
   const image=await page.evaluate(totalizerDisplayFixture,{text});
   const durations=[];
   for(let iteration=0;iteration<10;iteration++){
    const result=await page.evaluate(async image=>(await import('/src/totalizer-ocr.js')).detectTotalizerResult(image),image);
    assert.equal(result.reading,expected);assert.ok(result.attempt.durationMs<20000);durations.push(result.attempt.durationMs);
   }
   durations.sort((a,b)=>a-b);timings.push({sample:text,reading:expected,runs:durations.length,minMs:durations[0],p95Ms:durations[Math.ceil(durations.length*.95)-1],maxMs:durations.at(-1)});
  }
  assert.equal(blockedRequests,0,'Previously prepared primary files must not need any network request after refresh');
  assert.deepEqual(errors,[]);
  const budget=await page.evaluate(async()=>{const r=await import('/src/totalizer-ocr.js');return{clear:r.TOTALIZER_CLEAR_TARGET_MS,maximum:r.TOTALIZER_TIMEOUT_MS};});
  assert.deepEqual(budget,{clear:20000,maximum:30000});
  // Private station photos can be supplied for a read-only benchmark. Expected
  // readings are test assertions outside the recognizer, never inference input.
  if(process.env.TOTALIZER_PRIMARY_PHOTO){
   const image='data:image/jpeg;base64,'+fs.readFileSync(process.env.TOTALIZER_PRIMARY_PHOTO).toString('base64');
   const expected=Number(process.env.TOTALIZER_PRIMARY_EXPECTED),durations=[];
   assert.ok(Number.isFinite(expected),'The supplied benchmark photo needs an explicit expected reading');
   for(let iteration=0;iteration<10;iteration++){
    const result=await page.evaluate(async image=>(await import('/src/totalizer-ocr.js')).detectTotalizerResult(image),image);
    assert.equal(result.reading,expected,'The supplied reference photo must be read accurately');
    assert.equal(result.attempt.status,'detected');assert.ok(result.attempt.durationMs<20000);durations.push(result.attempt.durationMs);
   }
   durations.sort((a,b)=>a-b);timings.push({sample:'private original',reading:expected,runs:durations.length,minMs:durations[0],p95Ms:durations[Math.ceil(durations.length*.95)-1],maxMs:durations.at(-1)});
   for(const kind of ['distant','blurred']){
    const changed=await page.evaluate(async({image,kind})=>{
     const input=new Image();input.src=image;await input.decode();
     const canvas=document.createElement('canvas'),ratio=kind==='distant'?.5:1;canvas.width=Math.round(input.width*ratio);canvas.height=Math.round(input.height*ratio);
     const ctx=canvas.getContext('2d');if(kind==='blurred')ctx.filter='blur(1px)';ctx.drawImage(input,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.85);
    },{image,kind});
    const result=await page.evaluate(async image=>(await import('/src/totalizer-ocr.js')).detectTotalizerResult(image),changed);
    assert.ok(result.reading===null||result.reading===expected,'Reduced detail must never produce another reading');
    assert.ok(result.attempt.durationMs<30500);timings.push({sample:`private ${kind}`,reading:result.reading,status:result.attempt.status,milliseconds:result.attempt.durationMs});
   }
  }
  // On an already prepared page, neither model/runtime transfers nor the
  // image-analysis worker may need Wi-Fi to read the next photograph.
  let allBlockedRequests=0;
  await page.route('**/*',route=>{allBlockedRequests++;return route.abort();});
  const offlineImage=await page.evaluate(totalizerDisplayFixture,{text:'234567.89'});
  const offlineResult=await page.evaluate(async image=>(await import('/src/totalizer-ocr.js')).detectTotalizerResult(image),offlineImage);
  assert.equal(offlineResult.reading,234567.89);assert.ok(offlineResult.attempt.durationMs<20000);
  assert.equal(allBlockedRequests,0,'A prepared page must read the next photo with its workers and bytes already local');
  console.log('Prepared offline reader timings (local browser engine, not phone hardware):',JSON.stringify(timings));
 }finally{await browser.close();await server.close();}
});
