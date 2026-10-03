import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

test('Phone confirmation reaches a dirty desktop without re-entering readings or losing tank inputs',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:4338,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  let {state,key,cashier}=fixture();const report=state.reports[key];
  Object.values(state.reports).find(r=>r.confirmed).openingSetupComplete=true;
  report.cashCountConfirmed=true;report.actualCashCounted=200;report.cashDenominations={200:1};report.pilotCashRevision=1;report.pilotRevision=1;report.pilotLastNonReadingRevision=1;
  for(const row of report.pumpRows){const photo='/api/pilot/photo?id='+row.id;state.photos[photo]={branch:'Liloan',reportKey:key,rowId:row.id};Object.assign(row,{photo_path:photo,closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,readingRevision:1});}
  const errors=[],contexts=[];let failedDrafts=0,desktopPumpReads=0,phoneWrites=0;
  for(const width of [1280,390]){
   const ctx=await browser.newContext({viewport:{width,height:1000},timezoneId:'Asia/Manila'});contexts.push(ctx);
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.clock.install({time:new Date('2026-09-23T02:00:00Z')});
   await page.route('**/ocr/**',r=>r.abort());
   await page.route('**/api/**',async r=>{
    const path=new URL(r.request().url()).pathname;let result,status=200;
    if(path==='/api/pilot/photo')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="20" y="40">10012.00</text></svg>'});
    if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
    else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',token:'cookie',branch:'Liloan',expiresAt:Date.now()+3600000};
    else if(path==='/api/pilot/action'){
     const b=r.request().postDataJSON();
     if(width===1280&&b.route==='/api/demo/pump-report')desktopPumpReads++;
     if(width===390&&b.route==='/api/demo/pump-reading')phoneWrites++;
     if(width===1280&&b.route==='/api/reports/save'){failedDrafts++;return r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'Simulated unrelated draft conflict'})});}
     try{const out=await runAction(state,cashier,b.route,b.input,{mutationId:b.mutationId,uploadPhoto:async()=>{}});state=out.state;result=out.result;}
     catch(e){status=e.status||400;result={ok:false,error:e.message};}
    }else{status=404;result={ok:false,error:'Unmocked route'};}
    await r.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   await page.goto('http://127.0.0.1:4338/pilot/cashier');await page.getByLabel('Six-digit branch PIN').fill('000000');await page.getByRole('button',{name:'Proceed',exact:true}).click();
  }
  const desktop=contexts[0].pages()[0],phone=contexts[1].pages()[0];
  await desktop.locator('.cashier-shift-card').first().click();
  await desktop.getByRole('button',{name:'Open Reference Inventory and Deliveries',exact:true}).click();
  const tank=desktop.locator('.cashier-wizard-step table tbody tr').first().locator('input').last();await tank.fill('123');
  await desktop.clock.runFor(2000);await desktop.waitForFunction(()=>document.body.textContent.includes('Simulated unrelated draft conflict'));
  await phone.getByLabel('Shift to photograph').selectOption(key);
  const phoneCard=phone.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
  await phoneCard.getByRole('button',{name:'Edit number',exact:true}).click();
  await phoneCard.locator('input[inputmode=decimal]').fill('10012');await phoneCard.getByRole('button',{name:'Yes, confirm reading',exact:true}).click();
  await phoneCard.getByText(/Reading confirmed and saved/).waitFor();
  const writesAfterConfirm=phoneWrites;
  await desktop.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await desktop.waitForTimeout(300);assert.equal(await tank.inputValue(),'123');
  await desktop.getByRole('button',{name:'Open Pump Register',exact:true}).click();
  const card=desktop.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
  await card.getByText('10,012.00',{exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'Yes, confirm reading'}).count(),0);assert.equal(await card.locator('input[inputmode=decimal]').count(),0);
  assert.equal(phoneWrites,writesAfterConfirm);assert.ok(failedDrafts>0);assert.ok(desktopPumpReads>0);
  await desktop.getByRole('button',{name:'Open Reference Inventory and Deliveries',exact:true}).click();assert.equal(await tank.inputValue(),'123');
  await desktop.getByRole('button',{name:'Open Physical Cash',exact:true}).click();await desktop.getByText(/Physical cash confirmed/).waitFor();assert.equal(state.reports[key].actualCashCounted,200);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.httpServer.close(r));}
});
