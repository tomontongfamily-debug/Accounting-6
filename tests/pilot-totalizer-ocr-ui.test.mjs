import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {preview} from 'vite';
import fs from 'node:fs';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

test('Real seven-segment OCR reads the supplied glare photo through the phone upload flow',{skip:!process.env.TOTALIZER_TEST_PHOTO},async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:4335,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Asia/Manila'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let {state,key,report,cashier}=fixture();const uploads=new Map();let photoCount=0;
  // Only fixture data is changed. The recognizer never receives an opening value.
  for(const r of Object.values(state.reports)){
   r.pumpRows[0].opening=439853.29;
   if(r.confirmed)r.pumpRows[0].closing=439853.29;
  }
  await page.route('**/api/**',async request=>{
   const path=new URL(request.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/photo'){const photo=uploads.get(new URL(request.request().url()).searchParams.get('id'));return request.fulfill({contentType:'image/jpeg',body:photo});}
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',token:'cookie',branch:'Liloan',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){
    const body=request.request().postDataJSON();
    try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(path,image)=>{uploads.set(body.mutationId,image);photoCount++;}});state=out.state;result=out.result;}
    catch(e){status=e.status||400;result={ok:false,error:e.message};}
   }else{status=404;result={ok:false};}
   await request.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:4335/pilot/cashier');
  // The auth mock restores an already signed-in cashier; no PIN form remains.
  await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
  await page.getByLabel('Shift to photograph').selectOption(key);
  const card=page.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
  await card.locator('input[type=file]').setInputFiles(process.env.TOTALIZER_TEST_PHOTO);
  const input=card.locator('input[inputmode=decimal]');
  await page.waitForFunction(()=>[...document.querySelectorAll('input[inputmode=decimal]')].some(i=>i.value==='439931.31'),{},{timeout:120000});
  assert.equal(await input.inputValue(),'439931.31');assert.notEqual(await input.getAttribute('readonly'),null);
  assert.equal(photoCount,1);assert.equal(state.reports[key].pumpRows[0].readingConfirmed,false);
  assert.equal(state.reports[key].pumpRows[0].ocr_detected_reading,439931.31);
  page.on('dialog',d=>{errors.push('Unexpected reading warning: '+d.message());return d.dismiss();});
  await card.getByRole('button',{name:'Yes, confirm reading'}).click();await card.getByText('✓ Complete',{exact:true}).waitFor();
  assert.equal(state.reports[key].pumpRows[0].closing,439931.31);assert.equal(state.reports[key].pumpRows[0].ocr_detected_reading,439931.31);
  assert.equal(state.reports[key].confirmed,false);assert.equal(photoCount,1);
  assert.equal(await card.locator('input[inputmode=decimal]').count(),0);
  assert.equal(await card.getByRole('button',{name:'Yes, confirm reading'}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
  fs.mkdirSync('../../work/liloan-photo-cash-review',{recursive:true});await card.screenshot({path:'../../work/liloan-photo-cash-review/phone-automatic-43993131.png'});
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
