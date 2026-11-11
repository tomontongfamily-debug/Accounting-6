import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {compute} from '../src/accounting-engine.js';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';

async function openApp(browser,url,f,role,width=1280,time='2026-09-23T02:00:00Z'){
 let state=f.state;const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'Asia/Manila'}),errors=[],writes=[];
 page.on('pageerror',error=>errors.push(error.message));await page.clock.install({time:new Date(time)});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;let result,status=200;
  if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
  if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:state.startDate};
  else if(path==='/api/notifications/status')result={ok:true,checkedAt:new Date().toISOString(),alerts:[],push:{ready:false}};
  else if(path.startsWith('/api/auth/'))result={ok:true,role,branch:'Liloan',token:'cookie',expiresAt:Date.now()+3600000};
  else if(path==='/api/pilot/action'){const body=route.request().postDataJSON();if(body.route==='/api/prices/save'||body.route==='/api/demo/midshift-confirm')writes.push(body);try{const out=await runAction(state,{role,branch:'Liloan'},body.route,body.input,{mutationId:body.mutationId});state=out.state;result=out.result;}catch(error){status=error.status||400;result={ok:false,error:error.message};}}
  else result={ok:true,enabled:false};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(url+'/pilot/'+role.toLowerCase());
 return {page,errors,writes,getState:()=>state};
}

test('built daily price flow saves a small change, rejects wrong re-entry and cancellation, then saves exact large change',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const f=fixture(),app=await openApp(browser,`http://127.0.0.1:${server.httpServer.address().port}`,f,'Manager');const {page}=app;
  await page.getByRole('heading',{name:'Fuel Price Setup',exact:true}).waitFor();
  await page.getByLabel('Price Effective Date',{exact:true}).fill(f.report.date);
  const input=page.getByLabel('Regular Manager Price',{exact:true});
  let mode='small';const dialogs=[];
  page.on('dialog',async dialog=>{dialogs.push({type:dialog.type(),message:dialog.message()});if(mode==='cancel-confirm'&&dialog.type()==='confirm'||mode==='cancel-prompt'&&dialog.type()==='prompt')await dialog.dismiss();else await dialog.accept(dialog.type()==='prompt'?(mode==='wrong'?'66':'660') :undefined);});
  async function enter(value){await input.fill(value);await input.press('Enter');}
  await enter('66');await expect.poll(()=>app.getState().priceBook.Liloan[f.report.date]?.Regular).toBe('66.00');
  assert.equal(dialogs.length,1);assert.equal(dialogs[0].type,'confirm');assert.match(dialogs[0].message,/Station: Liloan/);assert.match(dialogs[0].message,/Product: Regular/);assert.match(dialogs[0].message,/All shifts/);
  mode='wrong';await enter('660');await expect.poll(()=>dialogs.some(d=>d.type==='alert')).toBe(true);assert.equal(app.writes.length,1);assert.equal(app.getState().priceBook.Liloan[f.report.date].Regular,'66.00');
  mode='cancel-confirm';const before=dialogs.length;await enter('660');await expect.poll(()=>dialogs.length).toBe(before+1);assert.equal(app.writes.length,1);
  mode='cancel-prompt';const beforePrompt=dialogs.length;await enter('660');await expect.poll(()=>dialogs.length).toBe(beforePrompt+2);assert.equal(app.writes.length,1);
  mode='large';await enter('660');await expect.poll(()=>app.getState().priceBook.Liloan[f.report.date].Regular).toBe('660.00');
  assert.equal(app.writes.length,2);assert.equal(app.writes[1].input.priceReview.Regular.typedPrice,'660');assert.deepEqual(app.errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});

function completedPumps(f){
 Object.values(f.state.reports).find(row=>row.confirmed).openingSetupComplete=true;
 const report=f.state.reports[f.key];Object.assign(report,{cashCountConfirmed:true,actualCashCounted:1000,cashDenominations:{1000:1},pilotRevision:1,pilot:true});
 for(const row of report.pumpRows){Object.assign(row,{closing:Number(row.opening)+10,closingEntrySource:'cashier',closingEntered:true,readingConfirmed:true,readingRevision:1,photo_path:'/api/pilot/photo?id='+row.id});f.state.photos[row.photo_path]={branch:'Liloan',reportKey:f.key,rowId:row.id};}
 return report;
}
test('built phone mid-shift confirmation requires exact re-entry after all price-change photos are saved',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const f=fixture(),report=completedPumps(f),change={id:'large',product:'Regular',effectiveTime:'09:00',newPrice:650,photoRequired:true,readings:{},readingPhotos:{}};
  report.midShiftBasePrices={...report.prices};report.midShiftPriceChanges=[change];
  for(const row of report.pumpRows.filter(row=>row.product==='Regular')){const key=midShiftPumpKey(row),path='/api/pilot/photo?id=price-'+row.id;change.readings[key]=Number(row.opening)+5;change.readingPhotos[key]={photo_path:path,readingConfirmed:true};f.state.photos[path]={branch:'Liloan',reportKey:f.key,rowId:row.id,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime};}
  const app=await openApp(browser,`http://127.0.0.1:${server.httpServer.address().port}`,f,'Manager',390),dialogs=[];
  app.page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept(dialog.type()==='prompt'?'650':undefined);});
  await app.page.getByLabel('Report Date',{exact:true}).fill(report.date);
  await app.page.getByRole('button',{name:'Confirm Regular Mid-Shift Price',exact:true}).click();
  await expect.poll(()=>!!app.getState().reports[f.key].midShiftPriceChanges[0].confirmedAt).toBe(true);
  assert.equal(dialogs.length,2);assert.match(dialogs[0],/Shift 1 · 09:00/);assert.equal(app.writes[0].input.priceReview.typedPrice,'650');assert.deepEqual(app.errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
test('manager can return to an ended morning draft and confirm its 9 AM change after cash and closing readings were saved',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const f=fixture(),report=completedPumps(f),closings=structuredClone(report.pumpRows);
  const change={id:'missed-9am',product:'Premium',effectiveTime:'09:00',newPrice:69,photoRequired:true,readings:{},readingPhotos:{}};
  report.midShiftBasePrices={...report.prices};report.midShiftPriceChanges=[change];
  for(const row of report.pumpRows.filter(row=>row.product==='Premium')){
   const pump=midShiftPumpKey(row),path='/api/pilot/photo?id=original-9am-'+row.id;
   change.readings[pump]=Number(row.opening)+5;change.readingPhotos[pump]={photo_path:path,readingConfirmed:true};
   f.state.photos[path]={branch:'Liloan',reportKey:f.key,rowId:row.id,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime};
  }
  const app=await openApp(browser,`http://127.0.0.1:${server.httpServer.address().port}`,f,'Manager',1280,'2026-09-23T07:30:00Z'),{page}=app;
  await page.getByLabel('Price Effective Date',{exact:true}).fill(report.date);
  await expect(page.getByText('Currently viewing: Liloan · 2026-09-23 · Shift 2',{exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Price-change shift',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'Price-change shift',exact:true}).selectOption('shift-1');
  await expect(page.getByText('Currently viewing: Liloan · 2026-09-23 · Shift 1',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Effective Time',{exact:true})).toHaveValue('09:00');
  await expect(page.getByText('Step 3: All readings saved. Confirm the new price below.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add Mid-Shift Price Change',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Confirm Premium Mid-Shift Price',exact:true})).toBeEnabled();
  page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Confirm Premium Mid-Shift Price',exact:true}).click();
  await expect.poll(()=>!!app.getState().reports[f.key].midShiftPriceChanges[0].confirmedAt).toBe(true);
  assert.deepEqual(app.getState().reports[f.key].pumpRows,closings);
  assert.equal(app.getState().reports[f.key].cashCountConfirmed,true);
  assert.equal(Number(app.getState().reports[f.key].actualCashCounted),1000);
  assert.equal(Number(app.getState().priceBook.Liloan[report.date].Premium),69);
  assert.deepEqual(app.errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});

test('built manual Fuel Redemption is explicitly pesos and saves the same peso deduction; automatic redemption stays read-only',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const automatic of [false,true]){
  const f=fixture(),report=completedPumps(f);
  if(automatic){report.deductions={...report.deductions,cashRedemption:0,fuelRedemption:0,posRedemption:75};report.posRedemptions={automatic:true,source:'FuelTech POS',status:'verified',verifiedAt:new Date().toISOString(),cashTotal:75,pointsStatus:'verified',pointsTotal:0,rows:[]};}
  const before=compute(report),app=await openApp(browser,`http://127.0.0.1:${server.httpServer.address().port}`,f,'Cashier'),{page}=app;
  await page.locator('.cashier-shift-card').first().click();await page.getByRole('button',{name:'Open Payments, Deductions and Other Sales',exact:true}).click();
  if(automatic){assert.equal(await page.getByLabel('Fuel Redemption (₱)',{exact:true}).count(),0);await expect(page.getByText('POS monetary redemption (automatic)',{exact:true})).toBeVisible();assert.equal(app.getState().reports[f.key].deductions.posRedemption,75);}
  else{const input=page.getByLabel('Fuel Redemption (₱)',{exact:true});await expect(input).toBeVisible();await expect(page.getByText('Enter the total peso value redeemed, not litres. Example: ₱500 redemption → enter 500.',{exact:true})).toBeVisible();await input.fill('500');await page.clock.fastForward(1000);await expect.poll(()=>Number(app.getState().reports[f.key].deductions.fuelRedemption)).toBe(500);assert.equal(before.expectedCash-compute(app.getState().reports[f.key]).expectedCash,500);assert.equal(before.totalLiters,compute(app.getState().reports[f.key]).totalLiters);}
  assert.deepEqual(app.errors,[]);await page.close();
 }}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
