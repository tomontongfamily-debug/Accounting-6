import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {pumpCameraBootstrap,capturePumpCamera,confirmPumpReading} from './pilot-camera-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {withStationRollout} from '../src/station-rollout.js';
import {createReport,reportKey} from '../src/accounting-engine.js';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';
import {runAction} from '../pilot/service.mjs';

test('Barili resumes the unfinished price nozzle, advances across all pumps, keeps background OCR and hands cashier photos to the manager',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-10T05:30:00Z')});
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let {state}=fixture();Object.assign(state,{mode:'live',startDate:'2026-10-03'});
 const config=withStationRollout({ok:true,mode:'live',start_date:state.startDate,launch:{ready:true}});prepareStationRollout(state,config);
 const prices={Premium:93.9,Regular:92.9,Diesel:94.1};state.priceBook.Barili={'2026-11-09':prices};
 const baseline=state.reports['Barili__2026-11-04__shift-3'];Object.assign(baseline,{confirmed:true,baselineConfirmed:true,openingSetupComplete:true});
 for(const row of baseline.pumpRows)Object.assign(row,{opening:10000,closing:10000,closingEntered:true});
 for(const row of baseline.tankRows)Object.assign(row,{opening:1000,actualDip:1000});
 const previous=createReport('Barili','2026-11-09',prices,'shift-3');Object.assign(previous,{confirmed:true,baselineConfirmed:true,openingSetupComplete:true});
 for(const row of previous.pumpRows)Object.assign(row,{opening:10000,closing:10000,closingEntered:true});state.reports[reportKey(previous.branch,previous.date,previous.shiftId)]=previous;
 const report=createReport('Barili','2026-11-10',prices,'shift-1'),key=reportKey(report.branch,report.date,report.shiftId);
 Object.assign(report,{pilot:true,baselineConfirmed:true,baselineMissing:false,pilotRevision:3,pilotLastNonReadingRevision:3,cashCountConfirmed:true,actualCashCounted:1000,cashDenominations:{1000:1}});
 for(const row of report.pumpRows){Object.assign(row,{opening:10000,closing:10020,setupRequired:false,closingEntered:true,readingConfirmed:true,readingRevision:2,photo_path:'/api/pilot/photo?id=closing-'+row.id});state.photos[row.photo_path]={reportKey:key,rowId:row.id,branch:'Barili'};}
 const change={id:'price-at-1126',product:'Premium',newPrice:91.9,effectiveTime:'11:26',photoRequired:true,readings:{},readingPhotos:{}};
 const premium=report.pumpRows.filter(row=>row.product==='Premium');assert.equal(premium.length,6);
 const first=premium[0],firstPath='/api/pilot/photo?id=original-price-photo';
 change.readings[midShiftPumpKey(first)]=10010;change.readingPhotos[midShiftPumpKey(first)]={photo_path:firstPath,readingConfirmed:true,readingRevision:2};
 state.photos[firstPath]={reportKey:key,rowId:first.id,branch:'Barili',changeId:change.id,product:change.product,effectiveTime:change.effectiveTime};
 report.midShiftBasePrices={...prices};report.midShiftPriceChanges=[change,{id:'blank',product:'Premium',newPrice:0,effectiveTime:'',readings:{},readingPhotos:{}}];state.reports[key]=report;
 const closingSnapshot=structuredClone(report.pumpRows),uploads=new Map(),errors=[],writes=[];let queue=Promise.resolve(),failUpload=true;
 async function open(role,width){
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Asia/Manila'});await context.addInitScript(pumpCameraBootstrap);
  await context.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:`export function subscribeTotalizerInvalidation(){return ()=>{};}export async function prepareTotalizer(){};let calls=0;export async function detectTotalizerResult(){const call=++calls;if(call===1)await new Promise(resolve=>globalThis.releasePriceReader=resolve);const reading=call===2?null:10010;return {reading,attempt:{status:reading===null?'no-reading':'detected',version:'price-browser-fixture'}};}`}));
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result=config;
   else if(path.startsWith('/api/auth/'))result={ok:true,role,branch:'Barili',token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();writes.push({role,...body});
    if(failUpload&&body.route==='/api/demo/photo'&&body.input.rowId===premium[2].id){status=503;result={ok:false,error:'Fixture upload interruption'};}
    else try{const out=await(queue=queue.catch(()=>{}).then(async()=>{const next=await runAction(state,{role,branch:'Barili'},body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(path,image)=>uploads.set(body.mutationId,image)});state=next.state;return next;}));result=out.result;}catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.clock.install();await page.clock.setFixedTime(Date.parse('2026-11-10T05:30:00Z'));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/${role.toLowerCase()}`);
  return {page,context};
 }
 try{
  const {page:phone}=await open('Cashier',390);await phone.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();await phone.getByLabel('Shift to photograph').selectOption(key);
  await expect(phone.getByLabel('Photos for')).toHaveValue(change.id);
  const active=()=>phone.locator('.midshift-photo-readings .reading-card:visible');
  await expect(active()).toHaveAttribute('data-pump-row-id',premium[1].id);
  assert.equal(await active().locator('input[type=file]').getAttribute('capture'),null,'Original price-change photos can be selected from the phone');
  await capturePumpCamera(phone,active());
  await expect(phone.getByRole('button',{name:'Next nozzle',exact:true})).toBeEnabled({timeout:10000});
  await phone.getByRole('button',{name:'Next nozzle',exact:true}).click();await expect(active()).toHaveAttribute('data-pump-row-id',premium[2].id);
  await phone.evaluate(()=>globalThis.releasePriceReader());
  await phone.getByRole('button',{name:'Previous nozzle',exact:true}).click();
  await expect(active().getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeVisible();await confirmPumpReading(active());
  await expect(active()).toHaveAttribute('data-pump-row-id',premium[2].id);
  await capturePumpCamera(phone,active());await expect(active().getByRole('button',{name:'Retry saving photo',exact:true})).toBeVisible();failUpload=false;await active().getByRole('button',{name:'Retry saving photo',exact:true}).click();
  await active().getByRole('button',{name:'Enter number manually',exact:true}).click();await active().getByRole('textbox',{name:/price-change reading$/}).fill('10010');await confirmPumpReading(active());
  await expect(active()).toHaveAttribute('data-pump-row-id',premium[3].id);
  await phone.reload();await phone.getByLabel('Shift to photograph').selectOption(key);await expect(active()).toHaveAttribute('data-pump-row-id',premium[3].id);
  // The first capture after reloading is the slow-reader fixture again.
  for(const [index,row] of premium.slice(3).entries()){
   await expect(active()).toHaveAttribute('data-pump-row-id',row.id);await capturePumpCamera(phone,active());
   if(index===0){await expect(phone.getByRole('button',{name:'Next nozzle',exact:true})).toBeEnabled({timeout:10000});await phone.evaluate(()=>globalThis.releasePriceReader());}
   await expect(active().getByRole('button',{name:/^(Yes, confirm reading|Enter number manually)$/})).toBeVisible({timeout:10000});
   if(await active().getByRole('button',{name:'Enter number manually',exact:true}).count()){await active().getByRole('button',{name:'Enter number manually',exact:true}).click();await active().getByRole('textbox',{name:/price-change reading$/}).fill('10010');}
   await confirmPumpReading(active());
  }
  await expect(phone.getByText('6 / 6 price-change photos confirmed',{exact:true})).toBeVisible();
  assert.deepEqual(state.reports[key].pumpRows,closingSnapshot,'Price-change photos must leave every closing reading/photo intact');
  assert.ok(!state.reports[key].midShiftPriceChanges[0].confirmedAt,'A cashier cannot confirm the selling price');
  const attempts=writes.filter(write=>write.route==='/api/demo/photo'&&write.input.rowId===premium[2].id);assert.ok(attempts.length>=2);assert.equal(new Set(attempts.map(write=>write.mutationId)).size,1,'Retry reuses the original upload receipt');
  await phone.getByLabel('Photos for').selectOption('closing');await phone.getByRole('heading',{name:'Closing pump readings',exact:true}).waitFor();
  const {page:manager}=await open('Manager',1280);await manager.getByLabel('Price Effective Date',{exact:true}).fill(report.date);await manager.getByText('Report Shift',{exact:true}).locator('..').locator('select').selectOption('shift-1');await manager.locator('.details-panel').filter({has:manager.getByText('Open only if fuel price changed in the middle of this shift',{exact:true})}).evaluate(node=>node.open=true);
  const confirm=manager.getByRole('button',{name:'Confirm Premium Mid-Shift Price',exact:true}).first();await expect(confirm).toBeEnabled();
  fs.mkdirSync('test-output',{recursive:true});await manager.locator('.midshift-photo-readings').first().screenshot({path:'test-output/barili-price-completed.png'});
  manager.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'91.90':undefined));await confirm.click();await expect.poll(()=>!!state.reports[key].midShiftPriceChanges[0].confirmedAt).toBe(true);
  assert.equal(Number(state.priceBook.Barili[report.date].Premium),91.9);assert.deepEqual(state.reports[key].pumpRows,closingSnapshot);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
