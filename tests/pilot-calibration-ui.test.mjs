import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview,createServer} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {compute} from '../src/accounting-engine.js';
import fs from 'node:fs';

for(const width of [1280])test(`built peso calibration saves and reloads without changing cash or pump evidence at ${width}px`,async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  let {state,key,cashier}=fixture();const report=state.reports[key];
  Object.values(state.reports).find(row=>row.confirmed).openingSetupComplete=true;
  Object.assign(report,{cashCountConfirmed:true,actualCashCounted:1000,cashDenominations:{1000:1},pilotRevision:1,pilot:true});
  for(const row of report.pumpRows){Object.assign(row,{closing:Number(row.opening)+(row.product==='Regular'?508:0),closingEntrySource:'cashier',closingEntered:true,readingConfirmed:true,readingRevision:1,photo_path:'/api/pilot/photo?id='+row.id});state.photos[row.photo_path]={branch:'Liloan',reportKey:key,rowId:row.id};}
  // Only one Regular nozzle sells fuel in this fixture.
  const regulars=report.pumpRows.filter(row=>row.product==='Regular');regulars.slice(1).forEach(row=>row.closing=row.opening);
  const expectedBefore=compute(report).expectedCash;
  const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'Asia/Manila'}),errors=[];
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
  const panel=page.getByRole('region',{name:'Calibration amount'}),input=page.getByLabel('Regular calibration amount in pesos',{exact:true});
  await expect(panel).toBeVisible();await expect(input).toHaveAttribute('max','33020.00');
  await expect(input).toHaveAttribute('step','0.01');await expect(panel.locator('.calibration-peso-input > span').nth(1)).toHaveText('₱');
  const reference=page.locator('section').filter({has:page.getByRole('heading',{name:'Reference Inventory',exact:true})}).last();
  assert.equal(await reference.getByLabel('Regular calibration amount in pesos',{exact:true}).count(),0);
  assert.equal(await page.getByLabel(/calibration.*\(L\)/).count(),0);
  await input.fill('999999');await expect(panel.getByRole('alert')).toContainText('cannot exceed');
  await page.clock.fastForward(1000);await expect(page.getByText(/Regular: calibration amount.*cannot exceed/).first()).toBeVisible();
  assert.equal(Number(state.reports[key].tankRows.find(row=>row.product==='Regular').calibration),0,'Rejected draft did not change saved calibration');
  await input.fill('564.24');await expect(panel.getByText('Regular calibration adjustment: −₱564.24')).toBeVisible();
  await page.clock.fastForward(1000);await expect.poll(()=>Number(state.reports[key].tankRows.find(row=>row.product==='Regular').calibration)).toBe(564.24);
  assert.equal(state.reports[key].tankRows.find(row=>row.product==='Regular').calibrationUnit,'PHP');
  assert.ok(Math.abs(expectedBefore-compute(state.reports[key]).expectedCash-564.24)<0.000001);
  assert.equal(state.reports[key].actualCashCounted,1000);
  assert.equal(state.reports[key].pumpRows.find(row=>row.id===regulars[0].id).closing,regulars[0].closing);
  await page.reload();await page.locator('.cashier-shift-card').first().click();
  await page.getByRole('button',{name:'Open Calibration, Inventory and Deliveries',exact:true}).click();
  await expect(input).toHaveValue('564.24');
  if(process.env.CALIBRATION_SCREENSHOT_DIR){fs.mkdirSync(process.env.CALIBRATION_SCREENSHOT_DIR,{recursive:true});await panel.screenshot({path:`${process.env.CALIBRATION_SCREENSHOT_DIR}/calibration-pesos-${width}.png`});}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});

test('peso calibration component fits a phone screen and submitted reports stay locked',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];
  page.setDefaultTimeout(5000);
  page.on('pageerror',error=>errors.push(error.message));
  const html=await server.transformIndexHtml('/calibration-pesos-test','<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module" src="/tests/calibration-pesos-ui-fixture.jsx"></script></body></html>');
  await page.route('**/calibration-pesos-test',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/calibration-pesos-test`);
  const input=page.getByLabel('Regular calibration amount in pesos',{exact:true});
  try{await input.waitFor();}catch(error){console.log(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw error;}
  await input.fill('564.24');await expect(page.getByText('Regular calibration adjustment: −₱564.24')).toBeVisible();
  await expect(page.getByLabel('Calibration expected cash')).toHaveText('4435.76');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await expect(input).toHaveAttribute('step','0.01');
  if(process.env.CALIBRATION_SCREENSHOT_DIR)await page.getByRole('region',{name:'Calibration amount'}).screenshot({path:`${process.env.CALIBRATION_SCREENSHOT_DIR}/calibration-pesos-390.png`});
  await page.getByRole('button',{name:'Show submitted report',exact:true}).click();await expect(input).toBeDisabled();assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
