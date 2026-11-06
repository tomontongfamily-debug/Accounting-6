import {confirmPumpReading} from './pilot-camera-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {preview} from 'vite';
import fs from 'node:fs';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {pumpCameraBootstrap,capturePumpCamera} from './pilot-camera-fixture.mjs';

test('Unreadable photo offers automatic retry first and keeps manual entry as an explicit override',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:4333,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Asia/Manila'});
  await page.addInitScript(pumpCameraBootstrap);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let {state,key,report,cashier}=fixture();const uploads=new Map();let photoCount=0;
  let allowUpload;const uploadGate=new Promise(resolve=>{allowUpload=resolve;});
  await page.route('**/ocr/**',r=>r.abort());
  await page.route('**/api/**',async request=>{
   const path=new URL(request.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/photo'){const photo=uploads.get(new URL(request.request().url()).searchParams.get('id'));return request.fulfill({contentType:'image/jpeg',body:photo});}
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
   else if(path==='/api/auth/station-session'){status=401;result={ok:false};}
    else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',token:'cookie',branch:'Liloan',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){
    const body=request.request().postDataJSON();
    try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(path,image)=>{await uploadGate;uploads.set(body.mutationId,image);photoCount++;}});state=out.state;result=out.result;}
    catch(e){status=e.status||400;result={ok:false,error:e.message};}
   }else{status=404;result={ok:false};}
   await request.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:4333/pilot/cashier');
  await page.getByLabel('Six-digit branch PIN').fill('000000');await page.getByRole('button',{name:'Proceed',exact:true}).click();
  await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
  await page.getByLabel('Shift to photograph').selectOption(key);
  const card=page.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
  assert.equal(await page.locator('input[type=file]').count(),0,'Phone pump photos must come from the live camera');
  await capturePumpCamera(page,card);
  assert.equal(await page.getByRole('button',{name:/^Pump 2 ·/}).isDisabled(),true,'Changing pumps must not discard an in-progress OCR result');
  allowUpload();
  await card.getByText('Automatic reader is unavailable on this attempt. The photo is saved. Retry the reader or check the photo and enter the number.',{exact:true}).waitFor({timeout:30000});
  assert.equal(await card.locator('input[inputmode=decimal]').count(),0);
  await card.getByRole('button',{name:'Enter number manually',exact:true}).click();
  const input=card.locator('input[inputmode=decimal]');assert.equal(await input.getAttribute('readonly'),null);
  assert.equal(state.reports[key].pumpRows[0].ocr_result.status,'error');
  await card.getByText('Automatic reader is unavailable on this attempt. The photo is saved. Retry the reader or check the photo and enter the number.',{exact:true}).waitFor();
  assert.equal(photoCount,1);assert.equal(await card.getByText(/Retake once more/).count(),0);
  await input.fill('9999');assert.equal(await card.getByRole('button',{name:/^(Yes, confirm reading|Save corrected reading)$/}).isEnabled(),false);
  await input.fill('10010');await confirmPumpReading(card);await card.getByText('✓ Complete',{exact:true}).waitFor();
  assert.equal(state.reports[key].pumpRows[0].closing,10010);assert.equal(state.reports[key].pumpRows[0].readingConfirmed,true);assert.ok(state.reports[key].pumpRows[0].photo_path);
  assert.equal(state.reports[key].confirmed,false);assert.equal(photoCount,1);
  assert.equal(state.reports[key].pumpRows[0].ocr_result.status,'error');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
  fs.mkdirSync('../../work/liloan-photo-cash-review',{recursive:true});await card.screenshot({path:'../../work/liloan-photo-cash-review/phone-reading-confirmed.png'});
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
