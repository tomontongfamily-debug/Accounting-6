import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import fs from 'node:fs';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

test('cashier saves a simple delivery, safely retries a lost response, and finds it after reloading',async t=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});t.after(()=>server.close());await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.clock.setFixedTime(new Date('2026-09-23T02:00:00Z'));
 let {state,key,cashier}=fixture();const report=state.reports[key];
 Object.values(state.reports).find(r=>r.confirmed).openingSetupComplete=true;
 report.cashCountConfirmed=true;report.actualCashCounted=200;report.cashDenominations={200:1};report.pilotCashRevision=1;report.pilotRevision=1;report.pilotLastNonReadingRevision=1;
 for(const row of report.pumpRows){const photo='/api/pilot/photo?id='+row.id;state.photos[photo]={branch:'Liloan',reportKey:key,rowId:row.id};Object.assign(row,{photo_path:photo,closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,readingRevision:1});}
 const photos=structuredClone(report.pumpRows),attempts=[];let lostResponses=2;
 await page.route('**/ocr/**',r=>r.abort());
 await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;let result,status=200;
  if(path==='/api/pilot/photo')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="20" y="40">Test pump</text></svg>'});
  if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
  else if(path==='/api/auth/station-session'){status=401;result={ok:false};}
  else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',token:'cookie',branch:'Liloan',expiresAt:Date.now()+3600000};
  else if(path==='/api/pilot/action'){
   const b=r.request().postDataJSON();
   try{
    const out=await runAction(state,cashier,b.route,b.input,{mutationId:b.mutationId});state=out.state;result=out.result;
    if(b.route==='/api/demo/delivery-save'){
     attempts.push(b);
     if(lostResponses-->0){status=503;result={ok:false,error:'The save response was interrupted. Please retry.'};}
    }
   }catch(e){status=e.status||400;result={ok:false,error:e.message};}
  }else{status=404;result={ok:false,error:'Unmocked route'};}
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 const url=`http://127.0.0.1:${server.httpServer.address().port}/pilot/cashier`;
 async function open(login=true){await page.goto(url);if(login){await page.getByLabel('Six-digit branch PIN').fill('000000');await page.getByRole('button',{name:'Proceed',exact:true}).click();}await page.locator('.cashier-shift-card').first().click();await page.getByRole('button',{name:'Open Reference Inventory and Deliveries',exact:true}).click();}
 await open();const section=page.getByRole('region',{name:'Fuel deliveries'});
 const tank=page.locator('.cashier-wizard-step table tbody tr').first().locator('input').last();await tank.fill('123');
 await section.getByLabel('Driver name',{exact:true}).fill('Test Driver');await section.getByLabel('Fuel',{exact:true}).selectOption('Diesel');
 await section.getByLabel('Liters delivered',{exact:true}).fill('3000');await section.getByLabel('Delivery time',{exact:true}).fill('10:30');
 assert.equal(await section.getByLabel(/Reference/i).count(),0);
 await section.getByRole('button',{name:'Save delivery',exact:true}).click();
 await section.getByRole('button',{name:'Retry saving delivery',exact:true}).waitFor();
 assert.equal(await section.getByLabel('Driver name').isDisabled(),true);assert.equal(await section.getByLabel('Liters delivered').inputValue(),'3000');
 await section.getByRole('button',{name:'Retry saving delivery',exact:true}).click();await section.getByRole('status').filter({hasText:'already saved'}).waitFor();
 assert.equal(new Set(attempts.map(a=>a.mutationId)).size,1);assert.equal(new Set(attempts.map(a=>JSON.stringify(a.input))).size,1);
 assert.equal(state.reports[key].deliveries.length,1);assert.equal(state.reports[key].tankRows.find(r=>r.product==='Diesel').delivery,3000);
 assert.equal(await tank.inputValue(),'123');assert.equal(state.reports[key].tankRows[0].actualDip,'123');
 const evidence=rows=>rows.map(({id,opening,closing,photo_path,readingConfirmed,readingRevision})=>({id,opening,closing,photo_path,readingConfirmed,readingRevision}));
 assert.deepEqual(evidence(state.reports[key].pumpRows),evidence(photos));assert.equal(state.reports[key].actualCashCounted,200);
 await open(false);await section.getByText(/Test Driver/).waitFor();assert.match(await section.innerText(),/3,000 L/);
 assert.equal(await section.getByLabel('Driver name').inputValue(),'');assert.deepEqual(errors,[]);
 fs.mkdirSync('../../work/simple-delivery-review',{recursive:true});await section.screenshot({path:'../../work/simple-delivery-review/desktop-delivery.png'});
});

test('the four-field delivery form fits a phone and keeps the driver for a second fuel',async t=>{
 const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{TankDeliveries}from'/src/tank-deliveries.jsx';import'/src/styles.css';import'/src/upgrade.css';function Demo(){const[r,set]=useState({branch:'Barili',date:'2026-11-05',shiftId:'shift-1',deliveries:[]});return <main style={{padding:20}}><TankDeliveries report={r} onSave={async delivery=>{set({...r,deliveries:[...r.deliveries,delivery]});return {ok:true};}}/></main>;}createRoot(document.getElementById('root')).render(<Demo/>);`;
 const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'delivery-fixture',resolveId(id){if(id==='/delivery-test.jsx')return id;},load(id){if(id==='/delivery-test.jsx')return entry;}}]});t.after(()=>server.close());await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844}});
 const html=await server.transformIndexHtml('/delivery-test','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/delivery-test.jsx"></script></body></html>');
 await page.route('**/delivery-test',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/delivery-test`);
 await page.getByLabel('Driver name').fill('Test Driver');await page.getByLabel('Fuel',{exact:true}).selectOption('Regular');await page.getByLabel('Liters delivered').fill('1000');await page.getByLabel('Delivery time').fill('10:30');
 await page.getByRole('button',{name:'Save delivery',exact:true}).click();await page.getByRole('status').filter({hasText:'Delivery saved.'}).waitFor();
 assert.equal(await page.getByLabel('Driver name').inputValue(),'Test Driver');assert.equal(await page.getByLabel('Liters delivered').inputValue(),'');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 fs.mkdirSync('../../work/simple-delivery-review',{recursive:true});await page.screenshot({path:'../../work/simple-delivery-review/phone-delivery.png',fullPage:true});
});
