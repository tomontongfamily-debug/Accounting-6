import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

test('built submit dialog requires confirmation only for zero sales and saves the server acknowledgement',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}}),port=server.httpServer.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const liters of [0,1]){
  let {state,key,cashier}=fixture();let report=state.reports[key];
  Object.values(state.reports).find(r=>r.confirmed).openingSetupComplete=true;
  Object.assign(report,{cashCountConfirmed:true,actualCashCounted:0,cashDenominations:{1000:0},pilotRevision:1,pilot:true});
  for(const row of report.pumpRows){Object.assign(row,{closing:Number(row.opening)+liters,closingEntered:true,closingEntrySource:'cashier',readingConfirmed:true,readingRevision:1,photo_path:'/api/pilot/photo?id='+row.id});state.photos[row.photo_path]={branch:'Liloan',reportKey:key,rowId:row.id};}
  state=(await runAction(state,cashier,'/api/demo/cash-check',{report})).state;
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'}),errors=[];let submitted=0;
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-09-23T02:00:00Z')});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:state.startDate};
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',branch:'Liloan',token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){const body=route.request().postDataJSON();if(body.input.operation==='submit')submitted++;try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId});state=out.state;result=out.result;}catch(e){status=e.status||400;result={ok:false,error:e.message};}}
   else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(`http://127.0.0.1:${port}/pilot/cashier`);await page.locator('.cashier-shift-card').first().click();
  await page.getByRole('button',{name:'Open Review and Submit',exact:true}).click();
  await page.getByRole('button',{name:'Submit Shift Report',exact:true}).click({timeout:5000});
  const dialog=page.getByRole('dialog'),button=dialog.getByRole('button',{name:'Confirm Report',exact:true}),checkbox=dialog.getByRole('checkbox');
  if(liters===0){await expect(button).toBeDisabled();assert.equal(submitted,0);await checkbox.check();await expect(button).toBeEnabled();}
  else{assert.equal(await checkbox.count(),0);await expect(button).toBeEnabled();}
  await button.click();await expect.poll(()=>state.reports[key].confirmed).toBe(true);
  assert.equal(submitted,1);assert.equal(!!state.reports[key].zeroSalesConfirmation,liters===0);assert.equal(state.reports[key].actualCashCounted,0);
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
