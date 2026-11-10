import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {bariliManualFixture} from './barili-manual-price-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {midShiftPumpKey} from '../src/mid-shift-price-change.js';

test('Barili one-change manual input works on phone and desktop, survives a lost save response, preserves all closing photos, and closes after manager confirmation',async t=>{
 const now=Date.parse('2026-11-10T17:10:00+08:00');t.mock.timers.enable({apis:['Date'],now});
 const f=bariliManualFixture();let state=f.state;
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],writes=[],receipts=new Map();let loseResponse=true,queue=Promise.resolve();
 const closing=structuredClone(f.report.pumpRows),original=structuredClone(f.change.readingPhotos[midShiftPumpKey(f.rows[0])]);
 async function open(role,width){
  const context=await browser.newContext({viewport:{width,height:950},timezoneId:'Asia/Manila'});
  await context.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:'export function subscribeTotalizerInvalidation(){return ()=>{};}export async function prepareTotalizer(){};export async function detectTotalizerResult(){throw Error("Manual flow must not invoke OCR");}'}));
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result=f.config;
   else if(path.startsWith('/api/auth/'))result={ok:true,role,branch:'Barili',token:'cookie',expiresAt:now+3600000};
   else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();writes.push({role,...body});
    try{
     result=await(queue=queue.catch(()=>{}).then(async()=>{
      if(receipts.has(body.mutationId))return receipts.get(body.mutationId);
      const out=await runAction(state,{role,branch:'Barili'},body.route,body.input,{mutationId:body.mutationId});state=out.state;
      if(body.route==='/api/demo/temporary-price-reading')receipts.set(body.mutationId,out.result);return out.result;
     }));
     if(loseResponse&&body.route==='/api/demo/temporary-price-reading'&&body.input.rowId===f.rows[1].id){status=503;result={ok:false,error:'Fixture lost manual save response. Retry the same reading.'};}
    }catch(error){status=error.status||400;result={ok:false,error:error.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.clock.install();await page.clock.setFixedTime(now);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/${role.toLowerCase()}`);return page;
 }
 async function enter(page,row,{lost=false}={}){
  const card=page.locator(`[data-manual-row-id="${row.id}"]:visible`);await card.getByRole('button',{name:'Enter price-change reading manually',exact:true}).click();
  const input=card.getByRole('textbox',{name:`${row.pump} ${row.nozzle} manual price-change reading`,exact:true});
  await input.fill('10021');await expect(card.getByRole('button',{name:'Review manual reading',exact:true})).toBeDisabled();
  await input.fill('10010');await card.getByRole('button',{name:'Review manual reading',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Confirm manual price-change reading',exact:true});await expect(dialog).toContainText('10010');await dialog.getByRole('button',{name:'Confirm manual reading',exact:true}).click();
  if(lost){await expect(dialog.getByRole('alert')).toContainText('lost manual save response');loseResponse=false;await dialog.getByRole('button',{name:'Confirm manual reading',exact:true}).click();}
  await expect(dialog).toHaveCount(0);await expect.poll(()=>state.reports[f.key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(row)]?.manualEntry?.value).toBe(10010);
 }
 async function openManagerTask(page){await page.getByRole('button',{name:'Open Shift 1 Premium price change at 11:26',exact:true}).click();await expect(page.getByText('Currently viewing: Barili · 2026-11-10 · Shift 1',{exact:true})).toBeVisible();}
 try{
  const phone=await open('Cashier',390);await phone.getByLabel('Shift to photograph').selectOption(f.key);
  await expect(phone.getByLabel('Photos for')).toHaveValue(f.change.id);
  await phone.getByLabel('Photos for').selectOption('closing');assert.equal(await phone.getByRole('button',{name:'Enter price-change reading manually',exact:true}).count(),0);
  await phone.getByLabel('Photos for').selectOption(f.change.id);await enter(phone,f.rows[1],{lost:true});
  const manager=await open('Manager',1280);await openManagerTask(manager);await enter(manager,f.rows[2]);
  await phone.reload();await phone.getByLabel('Shift to photograph').selectOption(f.key);
  for(const row of f.rows.slice(3))await enter(phone,row);
  await expect(phone.getByText('6 / 6 price-change readings confirmed',{exact:true})).toBeVisible();
  fs.mkdirSync('test-output',{recursive:true});await phone.screenshot({path:'test-output/barili-manual-phone.png',fullPage:true});
  assert.deepEqual(state.reports[f.key].pumpRows,closing);assert.deepEqual(state.reports[f.key].midShiftPriceChanges[0].readingPhotos[midShiftPumpKey(f.rows[0])],original);
  assert.equal(writes.some(write=>['/api/demo/photo','/api/demo/pump-reading'].includes(write.route)),false);
  const retries=writes.filter(write=>write.route==='/api/demo/temporary-price-reading'&&write.input.rowId===f.rows[1].id);assert.ok(retries.length>=3);assert.equal(new Set(retries.map(write=>write.mutationId)).size,1);
  assert.equal(state.audit.filter(row=>row.action==='price-change-manual-reading-saved').length,5);
  await manager.reload();await openManagerTask(manager);manager.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'91.90':undefined));
  await manager.getByRole('button',{name:'Confirm Premium Mid-Shift Price',exact:true}).click();await expect.poll(()=>!!state.reports[f.key].midShiftPriceChanges[0].confirmedAt).toBe(true);
  assert.equal(await manager.getByRole('button',{name:'Enter price-change reading manually',exact:true}).count(),0);assert.deepEqual(state.reports[f.key].pumpRows,closing);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
