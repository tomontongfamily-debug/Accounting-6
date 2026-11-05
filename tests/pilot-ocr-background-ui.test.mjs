import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {pumpCameraBootstrap,capturePumpCamera} from './pilot-camera-fixture.mjs';

for(const failedReader of [false,true])test(`photos save and pumps remain available while serialized OCR is held (reader failure=${failedReader})`,async()=>{
 const server=await createServer({cacheDir:'node_modules/.vite/ocr-background-test',server:{host:'127.0.0.1',port:0,strictPort:true}});await server.listen();
 const port=server.httpServer.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let {state,key,report,cashier}=fixture();
 const uploads=new Map(),writes=[],errors=[];
 const first=report.pumpRows[0],second=report.pumpRows.find(row=>row.pump!==first.pump);
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Asia/Manila'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(pumpCameraBootstrap);
  // Hold the recognizer indefinitely, including its real serial-queue behavior.
  // Two photo saves must complete before either OCR result is released.
  await page.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:`
   export async function prepareTotalizer(){}
   let queue=Promise.resolve();globalThis.finishOcr=[];
   export function detectTotalizerResult(){
    const result=queue.then(()=>new Promise(resolve=>globalThis.finishOcr.push(reading=>resolve({reading,attempt:{status:reading===null?'error':'detected',version:'background-fixture'}}))));
    queue=result;return result;
   }`}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let result,status=200;
   if(url.pathname==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
   else if(url.pathname.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
   else if(url.pathname==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(url.searchParams.get('id'))});
   else if(url.pathname==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    if(['/api/demo/photo','/api/demo/pump-reading'].includes(body.route))writes.push(body.route);
    try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(_path,image)=>uploads.set(body.mutationId,image)});state=out.state;result=out.result;}
    catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(`http://127.0.0.1:${port}/pilot/cashier`);
  await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
  await page.getByLabel('Shift to photograph').selectOption(key);
  const firstCard=page.locator(`[data-pump-row-id="${first.id}"]`);
  const secondCard=page.locator(`[data-pump-row-id="${second.id}"]`);
  await capturePumpCamera(page,firstCard);
  await expect(firstCard.getByRole('status')).toContainText('Photo saved. Automatic reading in progress.');
  assert.equal(uploads.size,1);
  assert.equal(state.reports[key].pumpRows[0].ocr_result.status,'pending');
  assert.equal(state.reports[key].pumpRows[0].readingConfirmed,false);
  assert.equal(await firstCard.getByRole('button',{name:'Yes, confirm reading',exact:true}).count(),0);
  // Report navigation stays locked so background work keeps its original shift.
  await expect(page.getByLabel('Shift to photograph')).toBeDisabled();
  await page.getByRole('button',{name:new RegExp(`^${second.pump} ·`)}).click();
  await expect(firstCard).toBeHidden();
  await capturePumpCamera(page,secondCard);
  await expect(secondCard.getByRole('status')).toContainText('Photo saved. Automatic reading in progress.');
  assert.equal(uploads.size,2);
  assert.equal(state.reports[key].pumpRows.find(row=>row.id===second.id).ocr_result.status,'pending');
  assert.deepEqual(writes,['/api/demo/photo','/api/demo/photo']);
  assert.equal(await page.evaluate(()=>globalThis.finishOcr.length),1);
  // The first card is hidden; its OCR must still save to the correct nozzle.
  await page.evaluate(value=>globalThis.finishOcr[0](value),first.opening+10);
  await expect.poll(()=>state.reports[key].pumpRows[0].ocr_detected_reading).toBe(first.opening+10);
  await expect.poll(()=>page.evaluate(()=>globalThis.finishOcr.length)).toBe(2);
  assert.equal(state.reports[key].pumpRows[0].readingConfirmed,false);
  await page.evaluate(value=>globalThis.finishOcr[1](value),failedReader?null:second.opening+10);
  await expect(page.getByLabel('Shift to photograph')).toBeEnabled();
  const savedSecond=state.reports[key].pumpRows.find(row=>row.id===second.id);
  assert.equal(savedSecond.ocr_result.status,failedReader?'error':'detected');
  assert.equal(savedSecond.readingConfirmed,false);
  assert.ok(savedSecond.photo_path);
  if(failedReader){
   await expect(secondCard.getByRole('status')).toContainText('The photo is saved.');
   await expect(secondCard.getByRole('button',{name:'Enter number manually',exact:true})).toBeEnabled();
  }else await expect(secondCard.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:new RegExp(`^${first.pump} ·`)}).click();
  await expect(firstCard.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
  await firstCard.getByRole('button',{name:'Yes, confirm reading',exact:true}).click();
  await expect(firstCard.getByText('✓ Complete',{exact:true})).toBeVisible();
  assert.equal(state.reports[key].pumpRows[0].closing,first.opening+10);
  assert.equal(uploads.size,2);
  assert.equal(writes.filter(route=>route==='/api/demo/photo').length,2);
  assert.equal(writes.filter(route=>route==='/api/demo/pump-reading').length,3);
  assert.equal(state.reports[key].confirmed,false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
