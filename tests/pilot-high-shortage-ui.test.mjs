import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {compute} from '../src/accounting-engine.js';
import {HIGH_SHORTAGE_MESSAGE} from '../pilot/domain.mjs';

test('built shortage block hides amounts, retains an editable draft, and allows a corrected pump reading to be submitted',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  let {state,key,cashier}=fixture();const report=state.reports[key];Object.values(state.reports).find(row=>row.confirmed).openingSetupComplete=true;
  Object.assign(report,{cashCountConfirmed:true,actualCashCounted:1000,cashDenominations:{1000:1},initialCashDenominations:{1000:1},cashReviewState:'final',recountRequired:true,pilot:true,pilotRevision:1,pilotLastNonReadingRevision:1});
  for(const row of report.pumpRows){Object.assign(row,{closing:Number(row.opening),closingEntered:true,closingEntrySource:'cashier',readingConfirmed:true,readingRevision:1,photo_path:'/api/pilot/photo?id='+row.id});state.photos[row.photo_path]={branch:'Liloan',reportKey:key,rowId:row.id};}
  const pump=report.pumpRows.find(row=>row.product==='Regular');pump.closing=Number(pump.opening)+100;report.reviewedExpectedCash=compute(report).expectedCash;
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'}),errors=[];let submits=0;
  page.on('pageerror',error=>errors.push(error.message));await page.clock.install({time:new Date('2026-09-23T02:00:00Z')});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:state.startDate};
   else if(path.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){const body=route.request().postDataJSON();if(body.input.operation==='submit')submits++;try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId});state=out.state;result=out.result;}catch(error){status=error.status||400;result={ok:false,error:error.message};}}
   else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/cashier`);await page.locator('.cashier-shift-card').first().click();
  await page.getByRole('button',{name:'Open Review and Submit',exact:true}).click();await page.getByRole('button',{name:'Submit Shift Report',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText(HIGH_SHORTAGE_MESSAGE);assert.doesNotMatch(await dialog.innerText(),/[0-9₱]/);assert.equal(submits,0);assert.equal(state.reports[key].confirmed,false);
  await dialog.getByRole('button',{name:'Close and Review',exact:true}).click();
  await expect(page.getByLabel('Final recount ₱1000 quantity',{exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Review pump readings',exact:true}).click();
  const card=page.locator(`[data-pump-row-id="${pump.id}"]`);await card.getByRole('button',{name:'Edit number',exact:true}).click();
  await card.getByRole('textbox').fill(String(Number(pump.opening)+40));await card.getByRole('button',{name:'Yes, confirm reading',exact:true}).click();
  await expect.poll(()=>state.reports[key].pumpRows.find(row=>row.id===pump.id).closing).toBe(Number(pump.opening)+40);
  await page.getByRole('button',{name:'Open Review and Submit',exact:true}).click();await page.getByRole('button',{name:'Check my cash count',exact:true}).click();
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm Report',exact:true}).click();
  await expect.poll(()=>state.reports[key].confirmed).toBe(true);assert.equal(submits,1);assert.equal(state.reports[key].actualCashCounted,1000);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
