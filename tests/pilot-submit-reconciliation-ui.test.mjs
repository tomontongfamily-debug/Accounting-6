import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {refreshPosEvidence} from '../pilot/pos-redemptions.mjs';

test('Submit explains unfinished cash reconciliation, focuses the next action, and completes after a recount',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:4354,strictPort:true}});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  let {state,key,cashier}=fixture();const report=state.reports[key];
  Object.values(state.reports).find(r=>r.confirmed).openingSetupComplete=true;
  for(const row of report.pumpRows){
   const photo_path='/api/pilot/photo?id='+row.id;
   state.photos[photo_path]={branch:'Liloan',reportKey:key,rowId:row.id};
   Object.assign(row,{closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,readingRevision:1,photo_path});
  }
  report.tankRows.forEach(row=>row.actualDip=10000);
  Object.assign(report,{pilot:true,pilotRevision:1,pilotLastNonReadingRevision:1,pilotCashRevision:1,cashCountConfirmed:true,cashDenominations:{1000:1},actualCashCounted:1000,cashReviewState:'',recountRequired:false});
  await refreshPosEvidence(state,{enabled:true,force:true,read:async()=>({rows:[{id:'pos-cash-test',date:report.date,shiftId:report.shiftId,type:'Cash',amount:20,quantity:0}],points:[]})});
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'});
  await page.clock.install({time:new Date('2026-09-23T02:00:00Z')});
  const errors=[];let submits=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"><text>10010</text></svg>'});
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:state.startDate};
   else if(path==='/api/auth/station-session'){status=401;result={ok:false};}
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',token:'cookie',branch:'Liloan',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    if(body.input.operation==='submit')submits++;
    try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId});state=out.state;result=out.result;}
    catch(e){status=e.status||400;result={ok:false,error:e.message};}
   }else{status=404;result={ok:false,error:'Unexpected test route'};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:4354/pilot/cashier');
  await page.getByLabel('Six-digit branch PIN').fill('000000');await page.getByRole('button',{name:'Proceed',exact:true}).click();
  await page.locator('.cashier-shift-card').first().click();
  await page.getByRole('button',{name:'Open Review and Submit',exact:true}).click();
  await page.getByText('Cash reconciliation is required. Press Check my cash count before submitting.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Check my cash count',exact:true}).evaluate(e=>e===document.activeElement),true);
  assert.equal(submits,0);assert.equal(state.reports[key].confirmed,false);assert.equal(state.reports[key].actualCashCounted,1000);
  await page.getByRole('button',{name:'Check my cash count',exact:true}).click();
  await page.getByText('A final cash recount is required. Enter the recounted quantities and press Confirm final recount before submitting.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).click();
  assert.equal(await page.getByLabel('Final recount ₱1000 quantity',{exact:true}).evaluate(e=>e===document.activeElement),true);
  assert.equal(submits,0);assert.equal(state.reports[key].confirmed,false);
  await page.getByLabel('Final recount ₱1000 quantity',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Confirm final recount',exact:true}).click();
  await page.getByText('✓ Final recount recorded. Admin will review the submitted result.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Go to cash reconciliation',exact:true}).count(),0);
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).click();
  const submitted=page.waitForResponse(r=>r.url().endsWith('/api/pilot/action')&&r.request().postDataJSON()?.input?.operation==='submit');
  await page.getByRole('dialog').getByRole('button',{name:'Confirm Report',exact:true}).click();
  const response=await submitted;
  assert.equal(response.status(),200,JSON.stringify(await response.json()));
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).waitFor({state:'detached'});
  assert.equal(submits,1);assert.equal(state.reports[key].confirmed,true);assert.equal(state.reports[key].actualCashCounted,1000);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.httpServer.close(r));}
});
