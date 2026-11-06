import {confirmPumpReading} from './pilot-camera-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {pumpCameraBootstrap,capturePumpCamera} from './pilot-camera-fixture.mjs';

for(const stage of ['photo','pump-reading'])for(const failure of ['unavailable','concurrent-save','legacy-conflict'])test(`a ${failure} ${stage} save preserves the capture and retries without repeating OCR`,async t=>{
 const server=await createServer({cacheDir:'node_modules/.vite/photo-retry-test',server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});t.after(()=>server.close());await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let {state,key,report,cashier}=fixture();
 let failing=true,photoAttempts=0,readingAttempts=0;const uploads=new Map(),errors=[];
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Asia/Manila'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(pumpCameraBootstrap);
  await page.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:`export async function prepareTotalizer(){};globalThis.recognitionCalls=0;export async function detectTotalizerResult(){globalThis.recognitionCalls++;return{reading:10010,attempt:{status:'detected',version:'retry-fixture',durationMs:1234}};}`}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let result,status=200;
   if(url.pathname==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
   else if(url.pathname.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
   else if(url.pathname==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(url.searchParams.get('id'))});
   else if(url.pathname==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    if(body.route==='/api/demo/photo')photoAttempts++;
    if(body.route==='/api/demo/pump-reading')readingAttempts++;
    if(failing&&body.route==='/api/demo/'+stage)return route.fulfill({status:failure==='unavailable'?503:409,contentType:'application/json',body:JSON.stringify(failure==='unavailable'?{ok:false,code:'STATION_RECORDS_UNAVAILABLE',error:'Unable to load verified station records.'}:failure==='concurrent-save'?{ok:false,retryableConflict:true,error:'The station changed while saving. Please retry.'}:{ok:false,error:'Another device saved first. Your changes are kept on this device. Load the saved shift before retrying.'})});
    try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(_path,image)=>uploads.set(body.mutationId,image)});state=out.state;result=out.result;}
    catch(e){status=e.status||400;result={ok:false,error:e.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/cashier`);
  await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
  await page.getByLabel('Shift to photograph').selectOption(key);
  const card=page.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
  await capturePumpCamera(page,card);
  const retry=card.getByRole('button',{name:stage==='photo'?'Retry saving photo':'Retry saving reading',exact:true});
  await expect(retry).toBeVisible();
  await expect(card.getByRole('alert')).toContainText('station server');
  assert.ok((await card.locator('.totalizer-photo').getAttribute('src')).startsWith('data:image/jpeg'));
  assert.equal(await card.getByRole('button',{name:/^(Yes, confirm reading|Save corrected reading)$/,exact:true}).count(),0);
  assert.equal(await card.getByRole('button',{name:'Enter number manually',exact:true}).count(),0);
  await expect(page.getByLabel('Shift to photograph')).toBeDisabled();
  assert.equal(stage==='photo'?photoAttempts:readingAttempts,1,'Do not automatically double the failed station read');
  failing=false;await retry.click();
  await expect(card.getByRole('button',{name:/^(Yes, confirm reading|Save corrected reading)$/,exact:true})).toBeEnabled();
  await expect(card).toContainText('Automatic reading: 1.2 seconds. Photo transfer and server saving are separate.');
  assert.equal(await page.evaluate(()=>globalThis.recognitionCalls),1);
  assert.equal(uploads.size,1,'Retrying the reading must not upload another photo');
  assert.equal(photoAttempts,stage==='photo'?2:1);
  assert.equal(readingAttempts,stage==='photo'?1:2);
  const saved=state.reports[key].pumpRows[0];
  assert.equal(saved.readingConfirmed,false);assert.equal(saved.ocr_detected_reading,10010);assert.equal(saved.ocr_result.durationMs,1234);
  await confirmPumpReading(card);
  await expect(card.getByText('✓ Complete',{exact:true})).toBeVisible();
  assert.equal(state.reports[key].pumpRows[0].closing,10010);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
