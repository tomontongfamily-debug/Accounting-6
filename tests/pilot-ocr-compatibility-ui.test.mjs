import {confirmPumpReading} from './pilot-camera-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'vite';
import {chromium,firefox,webkit,expect} from '@playwright/test';
import {totalizerDisplayFixture} from './totalizer-display-fixture.mjs';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

// Desktop browser engines at a narrow viewport exercise API compatibility.
// They do not emulate the CPU, camera sensor, network or OS of an actual phone.
// Extra engines require their Playwright binaries and explicit selection, e.g.
// TOTALIZER_COMPATIBILITY_BROWSERS=Chromium,Firefox,WebKit.
const selected=(process.env.TOTALIZER_COMPATIBILITY_BROWSERS||'Chromium').toLowerCase().split(',').map(name=>name.trim());
for(const {name,engine,launch}of [
 {name:'Chromium',engine:chromium,launch:{channel:'msedge'}},
 {name:'Firefox',engine:firefox,launch:{}},
 {name:'WebKit',engine:webkit,launch:{}},
])test(`${name}: real 8/9-cell OCR and native phone capture work without persistent cache or live camera APIs`,{skip:!selected.includes(name.toLowerCase()),timeout:90000},async()=>{
 const server=await createServer({cacheDir:`node_modules/.vite-compatibility-${name.toLowerCase()}`,server:{host:'127.0.0.1',port:0}});await server.listen();
 let browser;
 try{
  browser=await engine.launch({...launch,headless:true});
  const page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Asia/Manila'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   Object.defineProperty(globalThis,'caches',{configurable:true,value:undefined});
   Object.defineProperty(navigator,'connection',{configurable:true,value:undefined});
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined});
   Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:undefined});
   Object.defineProperty(HTMLVideoElement.prototype,'requestVideoFrameCallback',{configurable:true,value:undefined});
  });
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(origin+'/ocr/neural/README.md');
  const timings=[];
  for(const [text,expected]of [['234567.89',234567.89],['1234567.89',1234567.89],['1234567.890',null],['',null]]){
   const image=await page.evaluate(totalizerDisplayFixture,{text});
   const actual=await page.evaluate(async image=>{
    const {detectTotalizerResult}=await import('/src/totalizer-ocr.js');
    return detectTotalizerResult(image);
   },image);
   assert.equal(actual.reading,expected,`${name}: ${text||'blank'} must retain every integer digit and the visible decimal`);
   timings.push({text,reading:actual.reading,milliseconds:actual.attempt.durationMs});
  }
  // Private original photos can be supplied explicitly, never checked in.
  // Their reference numbers are assertions outside the recognizer.
  if(process.env.TOTALIZER_COMPATIBILITY_MANIFEST){
   const samples=JSON.parse(fs.readFileSync(process.env.TOTALIZER_COMPATIBILITY_MANIFEST,'utf8'));
   await page.evaluate(async()=>{const {prepareAdvancedTotalizer}=await import('/src/totalizer-reader-client.js');await prepareAdvancedTotalizer();});
   for(const [i,sample]of samples.entries()){
    const image='data:image/jpeg;base64,'+fs.readFileSync(sample.file).toString('base64');
    const actual=await page.evaluate(async image=>{const {detectTotalizerResult}=await import('/src/totalizer-ocr.js');return detectTotalizerResult(image);},image);
    assert.ok(actual.reading===null||actual.reading===sample.expected,`${name}: private station photo ${i+1} must not suggest an incorrect reading`);
    timings.push({privateSample:i+1,reading:actual.reading,milliseconds:actual.attempt.durationMs});
   }
  }
  const image=await page.evaluate(totalizerDisplayFixture,{text:'234567.89'});
  let {state,key,report,cashier}=fixture();const uploads=new Map();
  for(const saved of Object.values(state.reports)){
   saved.pumpRows[0].opening=234560;
   if(saved.confirmed)saved.pumpRows[0].closing=234560;
  }
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let result,status=200;
   if(url.pathname==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
   else if(url.pathname.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
   else if(url.pathname==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(url.searchParams.get('id'))});
   else if(url.pathname==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    try{
     const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(_path,bytes)=>uploads.set(body.mutationId,bytes)});
     state=out.state;result=out.result;
    }catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(origin+'/pilot/cashier');
  await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
  await page.getByLabel('Shift to photograph').selectOption(key);
  const card=page.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
  await card.getByRole('button',{name:'Open camera',exact:true}).click();
  const native=card.locator('input[type=file][capture]');
  await expect(native).toHaveAttribute('capture','environment');
  await native.setInputFiles({name:'native-camera.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});
  await expect(card.locator('input[inputmode=decimal]')).toHaveValue('234567.89',{timeout:25000});
  assert.equal(uploads.size,1);assert.equal(state.reports[key].pumpRows[0].readingConfirmed,false);
  assert.equal(state.reports[key].pumpRows[0].ocr_detected_reading,234567.89);
  await confirmPumpReading(card);
  await expect(card.getByText('✓ Complete',{exact:true})).toBeVisible();
  assert.equal(state.reports[key].pumpRows[0].closing,234567.89);
  assert.equal(state.reports[key].pumpRows[0].readingConfirmed,true);
  assert.equal(uploads.size,1);assert.equal(state.reports[key].confirmed,false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log(`${name} compatibility timings (local browser engine, not phone hardware):`,JSON.stringify(timings));
 }finally{await browser?.close();await server.close();}
});
