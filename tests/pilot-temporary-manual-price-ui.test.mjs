import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {bariliManualFixture} from './barili-manual-price-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';
import {BARILI_MANUAL_PRICE_GRANT as grant} from '../src/temporary-price-reading.js';
import {pumpCameraBootstrap,capturePumpCamera,confirmPumpReading} from './pilot-camera-fixture.mjs';

// No-photo grants remain historical evidence. New entries now use the owner's
// photo + typed number + final photo review flow, including on these old shifts.
for(const width of [390,1280])test(`legacy authorized readings survive and replacement requires a photo (${width}px)`,async t=>{
 const now=Date.parse(grant.startsAt)+600000;t.mock.timers.enable({apis:['Date'],now});
 const f=bariliManualFixture(),row=f.rows[1];
 let out=await runAction(f.state,f.manager,'/api/demo/temporary-price-reading',{reportKey:f.key,changeId:f.change.id,product:f.change.product,effectiveTime:f.change.effectiveTime,rowId:row.id,revision:0,reading:10010});
 let state=out.state;
 const legacy=structuredClone(state.reports[f.key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)]),closing=structuredClone(state.reports[f.key].pumpRows),errors=[],writes=[];
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width,height:950},timezoneId:'Asia/Manila'});await context.addInitScript(pumpCameraBootstrap);
  await context.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:`export function subscribeTotalizerInvalidation(){return ()=>{};}export async function prepareTotalizer(){throw Error('No OCR setup for manual photos');}export async function detectTotalizerResult(){throw Error('No OCR for manual photos');}`}));
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result=f.config;
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Manager',branch:'Barili',token:'cookie',expiresAt:now+3600000};
   else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><text x="30" y="100">10010.00</text></svg>'});
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();writes.push(body);
    try{const saved=await runAction(state,f.manager,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async()=>{}});state=saved.state;result=saved.result;}catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.clock.install();await page.clock.setFixedTime(now);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/manager`);
  await page.getByRole('button',{name:`Open Shift 1 Premium price change at ${f.change.effectiveTime}`,exact:true}).click();
  const section=page.locator(`[data-price-change-id="${f.change.id}"]`);
  await section.getByRole('group',{name:'Price-change nozzles',exact:true}).getByRole('button',{name:new RegExp(`^${row.pump} · ${row.nozzle}`)}).click();
  const card=section.locator('.reading-card:visible');
  await expect(section.getByText(/Earlier authorized manual reading saved:/)).toBeVisible();
  assert.deepEqual(state.reports[f.key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)],legacy);
  assert.equal(await section.getByRole('button',{name:'Enter price-change reading manually',exact:true}).count(),0);
  assert.equal(await card.getByRole('textbox').count(),0,'A new number cannot be entered without its photo');
  await capturePumpCamera(page,card);await card.getByRole('textbox',{name:/price-change reading$/}).fill('10010');await confirmPumpReading(card);
  await expect.poll(()=>state.reports[f.key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)]?.readingMethod).toBe('manual');
  const saved=state.reports[f.key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)];assert.ok(saved.photo_path);assert.equal(saved.manualEntry,undefined);assert.equal(saved.readingConfirmed,true);
  assert.equal(writes.some(write=>write.route==='/api/demo/temporary-price-reading'),false);assert.deepEqual(state.reports[f.key].pumpRows,closing);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
