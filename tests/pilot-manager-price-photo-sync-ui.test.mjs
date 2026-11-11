import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {withStationRollout} from '../src/station-rollout.js';
import {createReport,reportKey} from '../src/accounting-engine.js';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';
import {runAction} from '../pilot/service.mjs';

test('Barili PC receives unconfirmed phone photos for every product while an unrelated manager draft cannot save',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-11T07:30:00Z')});
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let {state}=fixture();Object.assign(state,{mode:'live',startDate:'2026-10-03'});
 const config=withStationRollout({ok:true,mode:'live',start_date:state.startDate,launch:{ready:true}});prepareStationRollout(state,config);
 const prices={Premium:93.9,Regular:92.9,Diesel:94.1};state.priceBook.Barili={'2026-11-11':prices};
 const baseline=state.reports['Barili__2026-11-04__shift-3'];Object.assign(baseline,{confirmed:true,baselineConfirmed:true,openingSetupComplete:true});
 for(const row of baseline.pumpRows)Object.assign(row,{opening:10000,closing:10000,closingEntered:true});
 const previous=createReport('Barili','2026-11-11',prices,'shift-1');Object.assign(previous,{confirmed:true,baselineConfirmed:true,openingSetupComplete:true});
 for(const row of previous.pumpRows)Object.assign(row,{opening:10000,closing:10000,closingEntered:true});state.reports[reportKey(previous.branch,previous.date,previous.shiftId)]=previous;
 const report=createReport('Barili','2026-11-11',prices,'shift-2'),key=reportKey(report.branch,report.date,report.shiftId);
 Object.assign(report,{pilot:true,baselineConfirmed:true,baselineMissing:false,pilotRevision:3,pilotLastNonReadingRevision:3,cashCountConfirmed:true,actualCashCounted:1000,cashDenominations:{1000:1}});
 for(const row of report.pumpRows)Object.assign(row,{opening:10000,closing:10020,closingEntered:true,readingConfirmed:true,readingRevision:2,photo_path:'/api/pilot/photo?id=closing-'+row.id});
 report.midShiftBasePrices={...prices};report.midShiftPriceChanges=Object.keys(prices).map(product=>({id:'price-'+product,product,newPrice:91.9,effectiveTime:'15:07',photoRequired:true,readings:{},readingPhotos:{}}));state.reports[key]=report;
 const closingSnapshot=structuredClone(report.pumpRows),errors=[];let failedDrafts=0,scopedReads=0,fullReads=0;
 const act=async(session,route,input,options={})=>{const out=await runAction(state,session,route,input,options);state=out.state;return out.result;};
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));await page.clock.install();await page.clock.setFixedTime(Date.parse('2026-11-11T07:30:00Z'));
  await page.route('**/ocr/**',route=>route.abort());
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result=config;
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Manager',branch:'Barili',token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="20" y="40">10010.00</text></svg>'});
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();if(body.route==='/api/demo/pump-report')scopedReads++;if(body.route==='/api/store/load')fullReads++;
    if(body.route==='/api/reports/save'){failedDrafts++;status=409;result={ok:false,error:'Fixture manager draft conflict'};}
    else try{result=await act({role:'Manager',branch:'Barili'},body.route,body.input,{mutationId:body.mutationId});}catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/manager`);
  await page.getByRole('button',{name:'Open Shift 2 Premium price change at 15:07',exact:true}).click();
  const premium=page.locator('[data-price-change-id="price-Premium"]'),price=premium.getByLabel('New Manager Price',{exact:true});
  await price.fill('91.8');await price.press('Tab');await page.clock.runFor(2500);
  await expect.poll(()=>failedDrafts).toBeGreaterThan(0);
  const readsBefore=fullReads;
  // A separate phone session saves one photo for each product, without yet
  // confirming any totalizer. The PC must show these real saved photos too.
  for(const change of report.midShiftPriceChanges){
   const row=report.pumpRows.filter(row=>row.product===change.product)[3];
   const input={reportKey:key,rowId:row.id,pumpKey:midShiftPumpKey(row),changeId:change.id,product:change.product,effectiveTime:change.effectiveTime,data:'data:image/jpeg;base64,/9j/2Q==',replaceReading:true,revision:0};
   await act({role:'Manager',branch:'Barili'},'/api/demo/photo',input,{mutationId:randomUUID(),uploadPhoto:async()=>{}});
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  for(const change of report.midShiftPriceChanges){
   const card=page.locator(`[data-price-change-id="${change.id}"]`),gallery=card.getByRole('group',{name:`${change.product} saved price-change photos`,exact:true});
   await expect(card.getByText('1 / 6 photos saved online.',{exact:false})).toBeVisible();
   await expect(gallery.locator('img')).toHaveCount(1);await expect(gallery).toContainText('Photo saved · confirm reading');
   await gallery.getByRole('button').click();await expect(card.locator('.reading-card:visible img').first()).toHaveAttribute('src',state.reports[key].midShiftPriceChanges.find(item=>item.id===change.id).readingPhotos[midShiftPumpKey(report.pumpRows.filter(row=>row.product===change.product)[3])].photo_path);
   await expect(card.getByText(/^0 \/ 6 price-change (photos|readings) confirmed$/)).toBeVisible();
  }
  assert.ok(scopedReads>0);assert.equal(fullReads,readsBefore,'The dirty full draft must not block the independent photo read');await expect(price).toHaveValue('91.80');
  assert.deepEqual(state.reports[key].pumpRows,closingSnapshot);assert.equal(state.reports[key].midShiftPriceChanges[0].newPrice,91.9);assert.ok(state.reports[key].midShiftPriceChanges.every(change=>!change.confirmedAt));assert.deepEqual(errors,[]);
  fs.mkdirSync('test-output',{recursive:true});await premium.screenshot({path:'test-output/barili-manager-photo-sync.png'});
 }finally{await browser.close();await server.close();}
});
