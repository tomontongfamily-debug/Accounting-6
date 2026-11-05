import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import fs from 'node:fs';
import {fixture,openingPhotos} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {ensureCurrentReports} from '../pilot/state.mjs';
import {withStationRollout} from '../src/station-rollout.js';
import {runAction} from '../pilot/service.mjs';

test('Pondol phone shows today’s Shift 1 after an already-confirmed setup with stale draft flags',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-05T12:29:00+08:00')});
 let {state}=fixture();state.mode='live';state.startDate='2026-10-03';
 const config=withStationRollout({ok:true,mode:'live',start_date:state.startDate,launch:{ready:true}}),cashier={role:'Cashier',branch:'Pondol'};
 prepareStationRollout(state,config);ensureCurrentReports(state);
 const setupKey='Pondol__2026-11-04__shift-3',shiftKey='Pondol__2026-11-05__shift-1';
 const opening=structuredClone(state.reports[setupKey]);opening.cashierName='Pondol cashier';
 opening.pumpRows=opening.pumpRows.map((r,i)=>({...r,opening:500000+i*100}));opening.tankRows=opening.tankRows.map(r=>({...r,opening:963}));opening.coke.beginning=46;opening.baselineConfirmed=true;
 state=await openingPhotos(state,opening);state=(await runAction(state,cashier,'/api/reports/save',{report:opening})).state;
 assert.equal(state.reports[setupKey].confirmed,true);assert.equal(state.reports[shiftKey].baselineMissing,true);
 const setupBefore=structuredClone(state.reports[setupKey]);
 const server=await preview({preview:{host:'127.0.0.1',port:4374,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Manila'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:Date.parse('2026-11-05T04:29:00Z')});
  await page.clock.setFixedTime(Date.parse('2026-11-05T04:29:00Z'));
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result=config;
   else if(path.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    try {ensureCurrentReports(state);const out=await runAction(state,cashier,body.route,body.input);state=out.state;result=out.result;}
    catch(e){status=e.status||400;result={ok:false,error:e.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:4374/cashier');
  assert.equal(await page.evaluate(()=>Date.now()),Date.parse('2026-11-05T04:29:00Z'));
  await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
  const picker=page.getByRole('combobox',{name:'Shift to photograph',exact:true});
  await expect(picker).toHaveValue(shiftKey);
  assert.ok((await picker.locator('option').allTextContents()).some(t=>t.includes('2026-11-05 · Shift 1')));
  assert.equal(state.reports[shiftKey].baselineMissing,false);assert.equal(state.reports[shiftKey].pumpRows[0].opening,500000);
  assert.deepEqual(state.reports[setupKey],setupBefore);assert.deepEqual(errors,[]);
  fs.mkdirSync('test-output',{recursive:true});await page.screenshot({path:'test-output/pondol-shift-one-available.png',fullPage:true});
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
