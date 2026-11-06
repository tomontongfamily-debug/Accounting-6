import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {pumpCameraBootstrap,capturePumpCamera} from './pilot-camera-fixture.mjs';

async function browserFixture(t,{stage='photo',lostResponse=false,held=false,storageUnavailable=false,delayedFirstOcr=false,failStatus=503}={}){
 const server=await createServer({cacheDir:'node_modules/.vite/ocr-durable-test',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});
 await server.listen();t.after(()=>server.close());
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:390,height:950},timezoneId:'Asia/Manila'});
 const f=fixture(),uploads=new Map(),receipts=new Map(),requests=[],errors=[];
 let state=f.state,failing=true,release,failureStatus=failStatus;
 const gate=held?new Promise(resolve=>{release=resolve;}):Promise.resolve();
 t.after(()=>release?.());
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(pumpCameraBootstrap);
 if(storageUnavailable)await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Device storage is unavailable','SecurityError');}}});});
 await page.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:`export async function prepareTotalizer(){};export async function detectTotalizerResult(){const count=Number(localStorage.getItem('test-recognition-count')||0)+1;localStorage.setItem('test-recognition-count',String(count));let reading=10010;if(${delayedFirstOcr}&&count===1)reading=await new Promise(resolve=>{globalThis.releaseFirstOcr=resolve;});return{reading,attempt:{status:'detected',version:'durable-test',durationMs:432,completedAt:new Date().toISOString()}};}`}));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let result,status=200;
  if(url.pathname==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:f.state.startDate};
  else if(url.pathname.startsWith('/api/auth/'))result={ok:true,...f.cashier,token:'cookie',expiresAt:Date.now()+3600000};
  else if(url.pathname==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(url.searchParams.get('id'))});
  else if(url.pathname==='/api/pilot/action'){
   const body=route.request().postDataJSON();
   const fail=failing&&body.route==='/api/demo/'+stage&&!body.input.row?.readingConfirmed;
   if(['/api/demo/photo','/api/demo/pump-reading'].includes(body.route))requests.push(body);
   if(fail)await gate;
   if(fail&&!lostResponse)return route.fulfill({status:failureStatus,contentType:'application/json',body:JSON.stringify({ok:false,code:'STATION_RECORDS_UNAVAILABLE',error:failureStatus===409?'This capture is no longer current. Retake its photo.':'The station server is unavailable. Retry the saved capture.'})});
   try{
    if(receipts.has(body.mutationId))result=receipts.get(body.mutationId);
    else{
     const out=await runAction(state,f.cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(_path,image)=>uploads.set(body.mutationId,image)});
     state=out.state;result=out.result;
     if(['/api/demo/photo','/api/demo/pump-reading'].includes(body.route))receipts.set(body.mutationId,result);
    }
    if(fail){status=503;result={ok:false,code:'STATION_RECORDS_UNAVAILABLE',error:'The station server response was lost. Retry the saved capture.'};}
   }catch(error){status=error.status||400;result={ok:false,error:error.message};}
  }else result={ok:true,enabled:false};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 const url=`http://127.0.0.1:${server.httpServer.address().port}/pilot/cashier`;
 async function open({reload=false}={}){
  if(reload)await page.reload();else await page.goto(url);
  await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
  const picker=page.getByLabel('Shift to photograph');
  if(await picker.inputValue()!==f.key)await picker.selectOption(f.key);
  return page.locator(`[data-pump-row-id="${f.report.pumpRows[0].id}"]`);
 }
 return {page,open,requests,uploads,errors,key:f.key,rowId:f.report.pumpRows[0].id,get state(){return state;},set state(value){state=value;},setFailureStatus(value){failureStatus=value;},recover(){failing=false;release?.();},release(){release?.();}};
}

test('local OCR result appears before a slow photo upload and survives a reload without another recognition',async t=>{
 const f=await browserFixture(t,{held:true});const card=await f.open();
 await capturePumpCamera(f.page,card);
 await expect(card.getByRole('status')).toContainText('Reading found: 10,010.00');
 assert.equal(f.uploads.size,0);
 f.release();await expect(card.getByRole('button',{name:'Retry saving photo',exact:true})).toBeVisible();
 const original=f.requests.find(r=>r.route==='/api/demo/photo');
 const restored=await f.open({reload:true});
 const retry=restored.getByRole('button',{name:'Retry saving photo',exact:true});await expect(retry).toBeVisible();
 f.recover();await retry.click();
 await expect(restored.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
 assert.equal(await f.page.evaluate(()=>Number(localStorage.getItem('test-recognition-count'))),1);
 const photoRequests=f.requests.filter(r=>r.route==='/api/demo/photo');
 assert.equal(photoRequests.length,2);assert.deepEqual(photoRequests[1],original);
 assert.equal(f.uploads.size,1);assert.equal(f.state.reports[f.key].pumpRows[0].ocr_detected_reading,10010);
 assert.deepEqual(f.errors,[]);
});

test('a lost OCR save response survives reload and replays the exact request without another upload or OCR',async t=>{
 const f=await browserFixture(t,{stage:'pump-reading',lostResponse:true});const card=await f.open();
 await capturePumpCamera(f.page,card);
 await expect(card.getByRole('button',{name:'Retry saving reading',exact:true})).toBeVisible();
 const original=f.requests.find(r=>r.route==='/api/demo/pump-reading');
 const restored=await f.open({reload:true});
 const retry=restored.getByRole('button',{name:'Retry saving reading',exact:true});await expect(retry).toBeVisible();
 f.recover();await retry.click();
 await expect(restored.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
 assert.equal(await f.page.evaluate(()=>Number(localStorage.getItem('test-recognition-count'))),1);
 assert.equal(f.requests.filter(r=>r.route==='/api/demo/photo').length,1);
 const readingRequests=f.requests.filter(r=>r.route==='/api/demo/pump-reading');
 assert.equal(readingRequests.length,2);assert.deepEqual(readingRequests[1],original);
 assert.equal(f.uploads.size,1);assert.equal(f.state.reports[f.key].pumpRows[0].ocr_result.status,'detected');
 assert.deepEqual(f.errors,[]);
});

test('a server-pending saved photo can rerun OCR without replacing its photo or manually entering a number',async t=>{
 const f=await browserFixture(t);f.recover();
 // Use a real saved camera photo, then model the result-save interruption.
 const card=await f.open();await capturePumpCamera(f.page,card);
 await expect(card.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
 const r=f.state.reports[f.key],row=r.pumpRows[0],photo=row.photo_path;
 Object.assign(row,{ocr_detected_reading:null,ocr_result:{status:'pending',version:'older-reader'},closing:'',closingEntered:false,readingConfirmed:false});
 const before=f.requests.filter(r=>r.route==='/api/demo/photo').length;
 const restored=await f.open({reload:true});
 await restored.getByRole('button',{name:'Retry automatic reading',exact:true}).click();
 await expect(restored.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
 assert.equal(f.requests.filter(r=>r.route==='/api/demo/photo').length,before);
 assert.equal(f.state.reports[f.key].pumpRows[0].photo_path,photo);
 assert.equal(f.state.reports[f.key].pumpRows[0].ocr_detected_reading,10010);
 assert.equal(f.state.reports[f.key].pumpRows[0].readingConfirmed,false);
 assert.deepEqual(f.errors,[]);
});

test('an older device capture cannot overwrite another device’s newer photo after reload',async t=>{
 const f=await browserFixture(t);const card=await f.open();
 await capturePumpCamera(f.page,card);
 await expect(card.getByRole('button',{name:'Retry saving photo',exact:true})).toBeVisible();
 const newerPhoto='/api/pilot/photo?id=00000000-0000-4000-8000-000000000001';
 const newer=structuredClone(f.state);
 Object.assign(newer.reports[f.key].pumpRows[0],{photo_path:newerPhoto,readingRevision:9,closing:10020,closingEntered:true,readingConfirmed:false});
 f.state=newer;
 const restored=await f.open({reload:true});
 const retry=restored.getByRole('button',{name:'Retry saving photo',exact:true});await expect(retry).toBeVisible();
 f.recover();await retry.click();
 await expect(restored.getByRole('alert')).toContainText('changed on another device');
 assert.equal(f.state.reports[f.key].pumpRows[0].photo_path,newerPhoto);
 assert.equal(f.state.reports[f.key].pumpRows[0].readingRevision,9);
 assert.equal(f.state.reports[f.key].pumpRows[0].closing,10020);
 assert.equal(f.uploads.size,0,'Revision rejection occurs before any replacement upload');
 assert.equal(await f.page.evaluate(()=>Number(localStorage.getItem('test-recognition-count'))),1);
 assert.deepEqual(f.errors,[]);
});

test('unavailable device recovery storage does not prevent immediate OCR and an online save',async t=>{
 const f=await browserFixture(t,{storageUnavailable:true});f.recover();const card=await f.open();
 await capturePumpCamera(f.page,card);
 await expect(card.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
 assert.equal(f.state.reports[f.key].pumpRows[0].ocr_detected_reading,10010);
 assert.equal(f.state.reports[f.key].pumpRows[0].readingConfirmed,false);
 assert.equal(f.uploads.size,1);
 assert.deepEqual(f.errors,[]);
});

test('late OCR from a rejected capture cannot resurrect it after reload',async t=>{
 const f=await browserFixture(t,{delayedFirstOcr:true,failStatus:409});const card=await f.open();
 await capturePumpCamera(f.page,card);
 await expect(card.getByRole('alert')).toContainText('no longer current');
 assert.equal(await f.page.evaluate(()=>typeof globalThis.releaseFirstOcr),'function');
 await f.page.evaluate(async()=>{globalThis.releaseFirstOcr(10009);await new Promise(resolve=>setTimeout(resolve,100));});
 const restored=await f.open({reload:true});
 await expect(restored.getByRole('button',{name:'Open camera',exact:true})).toBeEnabled();
 assert.equal(await restored.getByRole('button',{name:'Retry saving photo',exact:true}).count(),0);
 assert.equal(await restored.getByText('An unfinished capture was restored on this device. Retry saving it; no retake is needed.',{exact:true}).count(),0);
 assert.equal(f.uploads.size,0);assert.deepEqual(f.errors,[]);
});

test('late OCR from an old rejected photo cannot replace the newer recoverable capture',async t=>{
 const f=await browserFixture(t,{delayedFirstOcr:true,failStatus:409});const card=await f.open();
 await capturePumpCamera(f.page,card);
 await expect(card.getByRole('alert')).toContainText('no longer current');
 const first=f.requests.find(r=>r.route==='/api/demo/photo');
 f.setFailureStatus(503);
 await capturePumpCamera(f.page,card);
 await expect(card.getByRole('button',{name:'Retry saving photo',exact:true})).toBeVisible();
 const second=f.requests.filter(r=>r.route==='/api/demo/photo').at(-1);
 assert.notEqual(second.mutationId,first.mutationId);
 await f.page.evaluate(async()=>{globalThis.releaseFirstOcr(10009);await new Promise(resolve=>setTimeout(resolve,100));});
 const restored=await f.open({reload:true});
 const retry=restored.getByRole('button',{name:'Retry saving photo',exact:true});await expect(retry).toBeVisible();
 f.recover();await retry.click();
 await expect(restored.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
 assert.deepEqual(f.requests.filter(r=>r.route==='/api/demo/photo').at(-1),second);
 assert.equal(f.state.reports[f.key].pumpRows[0].ocr_detected_reading,10010);
 assert.equal(f.uploads.size,1);assert.deepEqual(f.errors,[]);
});

test('reload during unfinished OCR retains the photo request and reruns only the missing recognition',async t=>{
 const f=await browserFixture(t,{delayedFirstOcr:true});const card=await f.open();
 await capturePumpCamera(f.page,card);
 await expect(card.getByRole('button',{name:'Retry saving photo',exact:true})).toBeVisible();
 assert.equal(await f.page.evaluate(()=>typeof globalThis.releaseFirstOcr),'function');
 const first=f.requests.find(r=>r.route==='/api/demo/photo');
 const restored=await f.open({reload:true});
 const retry=restored.getByRole('button',{name:'Retry saving photo',exact:true});await expect(retry).toBeVisible();
 f.recover();await retry.click();
 await expect(restored.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
 assert.equal(await f.page.evaluate(()=>Number(localStorage.getItem('test-recognition-count'))),2);
 assert.deepEqual(f.requests.filter(r=>r.route==='/api/demo/photo').at(-1),first);
 assert.equal(f.state.reports[f.key].pumpRows[0].ocr_detected_reading,10010);
 assert.equal(f.uploads.size,1);assert.deepEqual(f.errors,[]);
});
