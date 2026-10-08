import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { fixture } from './pilot-fixture.mjs';
import { runAction } from '../pilot/service.mjs';
import { compute } from '../src/accounting-engine.js';

test('Reload avoids acknowledged stale cache and recovers a submission conflict from the server',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:4349,strictPort:true}});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  let {state,key,cashier}=fixture();const report=state.reports[key];
  Object.values(state.reports).find(r=>r.confirmed).openingSetupComplete=true;
  for(const row of report.pumpRows){
   const path='/api/pilot/photo?id='+row.id;
   state.photos[path]={branch:'Liloan',reportKey:key,rowId:row.id};
   Object.assign(row,{closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,readingRevision:1,photo_path:path});
  }
  report.tankRows.forEach(row=>row.actualDip=10000);
  Object.assign(report,{pilot:true,pilotRevision:46,pilotLastNonReadingRevision:46,pilotCashRevision:1,
   cashCountConfirmed:true,cashReviewState:'checked',recountRequired:false,notes:'Saved note',
   clientSave:{clientId:'desktop',version:100,mutationId:'desktop:100',baseVersion:0,branchDataVersion:'2026-07-31-rewind-to-july-30-1'}});
  report.actualCashCounted=compute(report).expectedCash;report.reviewedExpectedCash=compute(report).expectedCash;
  const stale={...structuredClone(report),pilotRevision:45,notes:'Old cached note'};
  const draftKey='fueltech-pilot-local_drafts_key:shadow:2026-09-23';
  const queueKey='fueltech-pilot-offline_queue_key:shadow:2026-09-23';
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'});
  await page.clock.install({time:new Date('2026-09-23T02:00:00Z')});
  await page.addInitScript(({draftKey,queueKey,key,stale})=>{
   localStorage.setItem(draftKey,JSON.stringify({[key]:stale}));
   localStorage.setItem(queueKey,JSON.stringify({[key]:stale}));
  },{draftKey,queueKey,key,stale});
  const errors=[];let ordinarySaves=0,submitAttempts=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"><text>10010</text></svg>'});
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
   else if(path==='/api/auth/station-session'){status=401;result={ok:false};}
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',token:'cookie',branch:'Liloan',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    if(body.route==='/api/reports/save'&&body.input.operation!=='submit')ordinarySaves++;
    if(body.route==='/api/reports/save'&&body.input.operation==='submit'){
     submitAttempts++;
     if(submitAttempts===1){
      Object.assign(state.reports[key],{pilotRevision:47,pilotLastNonReadingRevision:47,notes:'Newer saved note'});
      return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'This shift changed on another device. Refresh before saving.'})});
     }
     assert.equal(body.input.report.pilotRevision,47);assert.equal(body.input.report.notes,'Newer saved note');
    }
    try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId});state=out.state;result=out.result;}
    catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else{status=404;result={ok:false,error:'Unexpected test route'};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:4349/pilot/cashier');
  await page.getByLabel('Six-digit branch PIN').fill('000000');
  await page.getByRole('button',{name:'Proceed',exact:true}).click();
  await page.locator('.cashier-shift-card').first().click();
  assert.equal(ordinarySaves,0);
  await page.getByRole('button',{name:'Open Review and Submit',exact:true}).click();
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirm Report',exact:true}).click();
  await page.getByRole('button',{name:'Reload Latest Report',exact:true}).click();
  await page.getByRole('button',{name:'Reload Latest Report',exact:true}).waitFor({state:'detached'});
  // Read only test storage after the recovery; no navigation or page reload occurred.
  const kept=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),draftKey+':recovery');
  assert.equal(kept[key][0].at.length>0,true);assert.equal(kept[key][0].report.notes,'Saved note');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),draftKey), '{}');
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).click();
  const submittedResponse=page.waitForResponse(response=>response.url().endsWith('/api/pilot/action')&&response.request().postDataJSON()?.input?.operation==='submit');
  await page.getByRole('dialog').getByRole('button',{name:'Confirm Report',exact:true}).click();
  const response=await submittedResponse;
  assert.equal(response.status(),200,JSON.stringify(await response.json()));
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).waitFor({state:'detached'});
  assert.equal(state.reports[key].confirmed,true);assert.equal(submitAttempts,2);assert.equal(ordinarySaves,0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
