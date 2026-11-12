import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {bariliManualFixture} from './barili-manual-price-fixture.mjs';
import {pumpCameraBootstrap,capturePumpCamera,confirmPumpReading} from './pilot-camera-fixture.mjs';
import {BARILI_AFTERNOON_MANUAL_PRICE_GRANT as grant} from '../src/temporary-price-reading.js';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';
import {runAction} from '../pilot/service.mjs';

test('an old blank Barili phone draft recovers Diesel photos, stays on Pump 4 during refresh, and accepts manual typing with a saved photo',async t=>{
 const now=Date.parse(grant.startsAt)+600000;t.mock.timers.enable({apis:['Date'],now});
 const f=bariliManualFixture('Diesel',grant);let state=f.state;
 for(const row of f.rows.slice(1,-1)){
  const path='/api/pilot/photo?id=price-'+row.id;
  f.change.readings[midShiftPumpKey(row)]=10010;f.change.readingPhotos[midShiftPumpKey(row)]={photo_path:path,readingConfirmed:true,readingRevision:2};
  state.photos[path]={reportKey:f.key,rowId:row.id,branch:'Barili',changeId:f.change.id,product:'Diesel',effectiveTime:f.change.effectiveTime};
 }
 const stale={...structuredClone(f.report),pilotRevision:1,clientSave:{clientId:'stale-phone',version:10,mutationId:'stale-phone:10',branchDataVersion:'2026-07-30-global-reset-1'},midShiftPriceChanges:[{id:'blank-premium',product:'Premium',effectiveTime:'',newPrice:0,readings:{},readingPhotos:{}}]};
 const snapshot=structuredClone(f.report.pumpRows),writes=[],errors=[];let fullReads=0;
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:950},timezoneId:'Asia/Manila'});await context.addInitScript(pumpCameraBootstrap);
  await context.addInitScript(({stale,key,startDate})=>{
   for(const name of ['local_drafts','offline_queue'])localStorage.setItem(`fueltech-pilot-${name}_key:live:${startDate}`,JSON.stringify({[key]:stale}));
  },{stale,key:f.key,startDate:f.state.startDate});
  await context.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:'export function subscribeTotalizerInvalidation(){return ()=>{};}export async function prepareTotalizer(){};export async function detectTotalizerResult(){throw Error("Manual input must not invoke OCR");}'}));
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result=f.config;
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Manager',branch:'Barili',token:'cookie',expiresAt:now+3600000};
   else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();if(body.route==='/api/store/load')fullReads++;else if(!body.route.endsWith('pump-report'))writes.push(body);
    try{const out=await runAction(state,f.manager,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async()=>{}});state=out.state;result=out.result;}catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.clock.install();await page.clock.setFixedTime(now);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/manager`);
  const section=page.locator(`[data-price-change-id="${f.change.id}"]`),card=section.locator('.reading-card:visible');
  await expect(section.getByText('5 / 6 price-change readings confirmed',{exact:true})).toBeVisible();await expect(card).toHaveAttribute('data-pump-row-id',f.rows.at(-1).id);
  assert.equal(await page.locator('[data-price-change-id="blank-premium"]').count(),0);assert.equal(writes.filter(body=>body.route==='/api/reports/save').length,0,'An old empty queue must not overwrite saved price changes');
  await card.getByRole('button',{name:'Open camera',exact:true}).click();await expect(card.locator('video')).toBeVisible();
  const reads=fullReads;await page.clock.fastForward(6000);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.clock.runFor(5500);
  assert.equal(fullReads,reads,'The full-store poll cannot replace a live camera');await expect(card.locator('video')).toBeVisible();await expect(card).toHaveAttribute('data-pump-row-id',f.rows.at(-1).id);await card.getByRole('button',{name:'Cancel camera',exact:true}).click();
  await capturePumpCamera(page,card);await expect(card.getByRole('textbox',{name:/price-change reading$/})).toBeVisible();await card.getByRole('textbox',{name:/price-change reading$/}).fill('10010');await confirmPumpReading(card);
  await expect(section.getByText('6 / 6 price-change readings confirmed',{exact:true})).toBeVisible();assert.deepEqual(state.reports[f.key].pumpRows,snapshot);assert.equal(state.reports[f.key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(f.rows.at(-1))].readingMethod,'manual');
  const recovery=await page.evaluate(({key,startDate})=>JSON.parse(localStorage.getItem(`fueltech-pilot-local_drafts_key:live:${startDate}:recovery`)||'{}')[key],{key:f.key,startDate:f.state.startDate});assert.ok(recovery,'A recovery copy of the previous local draft stays on the phone');
  assert.deepEqual(errors,[]);fs.mkdirSync('test-output',{recursive:true});await section.screenshot({path:'test-output/barili-shift2-diesel-manual-recovered.png'});
 }finally{await browser.close();await server.close();}
});
