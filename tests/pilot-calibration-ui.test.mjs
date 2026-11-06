import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

test('built calibration field is separate from reference inventory and invalid entries remain correctable',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  let {state,key,cashier}=fixture();const report=state.reports[key];
  Object.values(state.reports).find(row=>row.confirmed).openingSetupComplete=true;
  Object.assign(report,{cashCountConfirmed:true,actualCashCounted:1000,cashDenominations:{1000:1},pilotRevision:1,pilot:true});
  for(const row of report.pumpRows){Object.assign(row,{closing:Number(row.opening)+(row.product==='Regular'?508:0),closingEntrySource:'cashier',closingEntered:true,readingConfirmed:true,readingRevision:1,photo_path:'/api/pilot/photo?id='+row.id});state.photos[row.photo_path]={branch:'Liloan',reportKey:key,rowId:row.id};}
  // Only one Regular nozzle sells fuel in this fixture.
  const regulars=report.pumpRows.filter(row=>row.product==='Regular');regulars.slice(1).forEach(row=>row.closing=row.opening);
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.clock.install({time:new Date('2026-09-23T02:00:00Z')});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:state.startDate};
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',branch:'Liloan',token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){const body=route.request().postDataJSON();try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId});state=out.state;result=out.result;}catch(error){status=error.status||400;result={ok:false,error:error.message};}}
   else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/cashier`);await page.locator('.cashier-shift-card').first().click();
  await page.getByRole('button',{name:'Open Calibration, Inventory and Deliveries',exact:true}).click();
  const panel=page.getByRole('region',{name:'Returned calibration'}),input=page.getByLabel('Regular returned calibration (L)',{exact:true});
  await expect(panel).toBeVisible();await expect(input).toHaveAttribute('max','508');
  const reference=page.locator('section').filter({has:page.getByRole('heading',{name:'Reference Inventory',exact:true})}).last();
  assert.equal(await reference.getByLabel('Regular returned calibration (L)',{exact:true}).count(),0);
  await input.fill('564.24');await expect(panel.getByRole('alert')).toContainText('cannot exceed');
  await page.clock.fastForward(1000);await expect(page.getByText(/Regular: returned calibration.*cannot exceed/).first()).toBeVisible();
  assert.equal(Number(state.reports[key].tankRows.find(row=>row.product==='Regular').calibration),0,'Rejected draft did not change saved calibration');
  await input.fill('5');await expect(panel.getByText('Regular pump-sales adjustment: −₱325.00')).toBeVisible();
  await page.clock.fastForward(1000);await expect.poll(()=>Number(state.reports[key].tankRows.find(row=>row.product==='Regular').calibration)).toBe(5);
  assert.equal(state.reports[key].pumpRows.find(row=>row.id===regulars[0].id).closing,regulars[0].closing);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
