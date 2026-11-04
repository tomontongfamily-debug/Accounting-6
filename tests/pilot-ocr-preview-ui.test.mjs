import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {pumpCameraBootstrap,capturePumpCamera} from './pilot-camera-fixture.mjs';

for(const failPhoto of [false,true])test(`a local reading appears during a held upload and cannot be confirmed before saving (failure=${failPhoto})`,async()=>{
 const port=failPhoto?44343:44342;
 const server=await createServer({server:{host:'127.0.0.1',port,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let releasePhoto,releaseReading;
 const photoGate=new Promise(resolve=>{releasePhoto=resolve;}),readingGate=new Promise(resolve=>{releaseReading=resolve;});
 let {state,key,report,cashier}=fixture();
 const uploads=new Map();let readingSaveStarted=false;
 try {
  const page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Asia/Manila'});
  await page.addInitScript(pumpCameraBootstrap);
  await page.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:`export async function prepareTotalizer(){};export async function detectTotalizerResult(){return{reading:10010,attempt:{status:'detected',version:'preview-fixture'}};}`}));
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
   else if(path.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(new URL(route.request().url()).searchParams.get('id'))});
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    if(body.route==='/api/demo/photo'){
     await photoGate;
     if(failPhoto)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'Photo could not be saved. Retry.'})});
    }
    if(body.route==='/api/demo/pump-reading'){readingSaveStarted=true;await readingGate;}
    try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(_path,image)=>uploads.set(body.mutationId,image)});state=out.state;result=out.result;}
    catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(`http://127.0.0.1:${port}/pilot/cashier`);
  await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
  await page.getByLabel('Shift to photograph').selectOption(key);
  const card=page.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
  await capturePumpCamera(page,card);
  await expect(card.getByRole('status')).toContainText('Reading found: 10,010.00');
  assert.ok((await card.locator('.totalizer-photo').getAttribute('src')).startsWith('data:image/jpeg'));
  assert.equal(await card.getByRole('button',{name:'Yes, confirm reading',exact:true}).count(),0);
  assert.notEqual(state.reports[key].pumpRows[0].readingConfirmed,true);
  assert.equal(uploads.size,0);
  if(!failPhoto)await card.screenshot({path:'../../outputs/Pump-OCR-immediate-preview.png'});
  releasePhoto();
  if(failPhoto){
   await expect(card.getByRole('alert')).toContainText('Photo could not be saved');
   assert.equal(await card.getByRole('button',{name:'Yes, confirm reading',exact:true}).count(),0);
   assert.equal(await card.locator('.totalizer-photo').count(),0);
   assert.equal(uploads.size,0);
  }else{
   await expect.poll(()=>readingSaveStarted).toBe(true);
   assert.equal(await card.getByRole('button',{name:'Yes, confirm reading',exact:true}).count(),0);
   releaseReading();
   await expect(card.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
   assert.equal(state.reports[key].pumpRows[0].readingConfirmed,false);
   assert.equal(state.reports[key].pumpRows[0].ocr_detected_reading,10010);
  }
 }finally{releasePhoto();releaseReading();await browser.close();await server.close();}
});
