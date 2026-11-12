import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {withStationRollout,ALL_STATIONS,stationOpeningSlot} from '../src/station-rollout.js';
import {createReport,reportKey} from '../src/accounting-engine.js';
import {runAction} from '../pilot/service.mjs';

test('every station can request date correction on phone and inside a desktop report, with honest errors and saved reports kept locked',async t=>{
 const now=Date.parse('2026-11-12T03:55:00Z');t.mock.timers.enable({apis:['Date'],now});
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const branch of ALL_STATIONS.filter(branch=>!process.env.CORRECTION_TEST_BRANCH||branch===process.env.CORRECTION_TEST_BRANCH))for(const width of [390,1280])await t.test(`${branch} ${width===390?'phone':'desktop'}`,async()=>{
   let {state}=fixture();Object.assign(state,{mode:'live',startDate:'2026-10-03'});
   const config=withStationRollout({ok:true,mode:'live',start_date:state.startDate,launch:{ready:true}});prepareStationRollout(state,config);
   const prices={Premium:70,Regular:65,Diesel:60};state.priceBook[branch]={'2026-11-10':prices};
   const slot=stationOpeningSlot(config,branch),openingKey=reportKey(branch,slot.date,slot.shiftId),opening=state.reports[openingKey]||createReport(branch,slot.date,prices,slot.shiftId);
   Object.assign(opening,{confirmed:true,baselineReport:true,baselineConfirmed:true,openingSetupComplete:true});for(const row of opening.pumpRows)Object.assign(row,{opening:10000,closing:10000,closingEntered:true});for(const row of opening.tankRows)Object.assign(row,{opening:1000,actualDip:1000});state.reports[openingKey]=opening;
   const target=createReport(branch,'2026-11-11',prices,'shift-1'),key=reportKey(branch,target.date,target.shiftId);
   Object.assign(target,{pilot:true,pilotRevision:7,confirmed:true,confirmedAt:'2026-11-11T05:00:00Z',baselineConfirmed:true,baselineMissing:false,cashCountConfirmed:true,actualCashCounted:500,cashDenominations:{100:5}});
   for(const row of target.pumpRows)Object.assign(row,{opening:10000,closing:10010,closingEntered:true,readingConfirmed:true,readingRevision:2,photo_path:'/api/pilot/photo?id='+row.id});state.reports[key]=target;
   const snapshot=structuredClone(target),errors=[];let fail=true,requestCount=0;
   const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'Asia/Manila'});
   await context.route('**/ocr/**',route=>route.abort());
   await context.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let result,status=200;
    if(path==='/api/pilot/config')result=config;
    else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',branch,token:'cookie',expiresAt:now+3600000};
    else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
    else if(path==='/api/pilot/action'){
     const body=route.request().postDataJSON();
     if(body.route==='/api/reports/save'&&body.input.operation==='request-correction'){
      requestCount++;
      if(fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Fixture correction request unavailable'})});
     }
     try{const out=await runAction(state,{role:'Cashier',branch},body.route,body.input,{mutationId:body.mutationId});state=out.state;result=out.result;}catch(error){status=error.status||400;result={ok:false,error:error.message};}
    }else result={ok:true,enabled:false};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.clock.install();await page.clock.setFixedTime(now);
   try {await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/cashier`);
   if(await page.getByLabel('Six-digit branch PIN').count()){await page.getByLabel('Six-digit branch PIN').fill('000000');await page.getByRole('button',{name:'Proceed',exact:true}).click();}
   if(width===1280){const shift=page.locator('.cashier-shift-card:not([disabled])').first();await shift.click();}
   const panel=page.getByRole('region',{name:'Date corrections',exact:true});await expect(panel.getByRole('button',{name:'Request Date Correction',exact:true})).toBeVisible();
   await panel.getByRole('button',{name:'Request Date Correction',exact:true}).click();await panel.getByLabel('Report Date',{exact:true}).fill(target.date);await panel.getByLabel('Shift',{exact:true}).selectOption(target.shiftId);
   await panel.getByRole('button',{name:'Send Request to Admin',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('reason');assert.equal(requestCount,0);
   await panel.getByLabel('Reason',{exact:true}).fill('Test only: incorrect pump photo');await panel.getByRole('button',{name:'Send Request to Admin',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('Fixture correction request unavailable');assert.deepEqual(state.reports[key],snapshot);
   state.reports[key].pilotRevision++;state.reports[key].notes='Newer saved note from another device';
   fail=false;await panel.getByRole('button',{name:'Send Request to Admin',exact:true}).click();await expect(panel.getByText(/Correction request saved online/)).toBeVisible();assert.equal(state.reports[key].notes,'Newer saved note from another device');
   assert.equal(state.reports[key].correctionRequest.status,'pending');assert.equal(state.reports[key].confirmed,true);assert.deepEqual(state.reports[key].pumpRows,snapshot.pumpRows);assert.deepEqual(state.reports[key].cashDenominations,snapshot.cashDenominations);assert.equal(state.reports[key].actualCashCounted,500);
   await expect(panel.getByText(/waiting for Admin approval/)).toBeVisible();await page.reload();await expect(page.getByRole('region',{name:'Date corrections',exact:true}).getByText(/waiting for Admin approval/)).toBeVisible();assert.deepEqual(errors,[]);
   if(branch==='Liloan'&&width===390){fs.mkdirSync('test-output',{recursive:true});await page.screenshot({path:'test-output/liloan-phone-correction-access.png',fullPage:true});}
   await context.close();}catch(error){console.log(branch,width,(await page.locator('body').innerText()).slice(0,2400));throw error;}
  });
 }finally{await browser.close();await server.close();}
});
