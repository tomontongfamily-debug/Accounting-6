import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {withStationRollout} from '../src/station-rollout.js';
import {runAction} from '../pilot/service.mjs';
import {MABOLO_TOTALIZER_FORMAT_ID} from '../src/ocr-evidence.js';
import {pumpCameraBootstrap,capturePumpCamera,confirmPumpReading} from './pilot-camera-fixture.mjs';

test('Mabolo camera uses the confirmed format and persists its evidence before cashier confirmation',
 {skip:!process.env.TOTALIZER_MABOLO_PHOTO},async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-04T22:05:00+08:00')});
  const server=await preview({preview:{host:'127.0.0.1',port:4336,strictPort:true}});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
   const expected=Number(process.env.TOTALIZER_MABOLO_EXPECTED),page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Asia/Manila'});
   await page.addInitScript(pumpCameraBootstrap,{imageDataUrl:'data:image/jpeg;base64,'+fs.readFileSync(process.env.TOTALIZER_MABOLO_PHOTO).toString('base64')});
   await page.clock.install();await page.clock.setFixedTime(Date.parse('2026-11-04T14:05:00Z'));
   let {state}=fixture();state.mode='live';state.startDate='2026-10-03';
   const config=withStationRollout({ok:true,mode:'live',start_date:state.startDate,launch:{ready:true}});
   prepareStationRollout(state,config);
   const key='Mabolo__2026-11-04__shift-3',rowId=state.reports[key].pumpRows[0].id,cashier={role:'Cashier',branch:'Mabolo'};
   const uploads=new Map(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let result,status=200;
    if(url.pathname==='/api/pilot/config')result=config;
    else if(url.pathname.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
    else if(url.pathname==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(url.searchParams.get('id'))});
    else if(url.pathname==='/api/pilot/action'){
     const body=route.request().postDataJSON();
     try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(_path,image)=>uploads.set(body.mutationId,image)});state=out.state;result=out.result;}
     catch(e){status=e.status||400;result={ok:false,error:e.message};}
    }else result={ok:true,enabled:false};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   await page.goto('http://127.0.0.1:4336/pilot/cashier');
   await page.getByRole('heading',{name:'Choose a shift',exact:true}).waitFor();
   await page.locator('.cashier-opening-card').click();
   await page.getByRole('heading',{name:'Opening pump readings',exact:true}).waitFor();
   await page.getByLabel('Setup Cashier Name',{exact:true}).fill('Format test cashier');
   await expect.poll(()=>state.reports[key].cashierName).toBe('Format test cashier');
   const card=page.locator(`[data-pump-row-id="${rowId}"]`);
   await capturePumpCamera(page,card);
   const input=card.locator('input[inputmode=decimal]');
   await expect(input).toHaveValue(expected.toFixed(2),{timeout:45000});
   await expect.poll(()=>state.reports[key].pumpRows[0].ocr_result?.formatProfile).toBe(MABOLO_TOTALIZER_FORMAT_ID);
   assert.equal(state.reports[key].pumpRows[0].readingConfirmed,false);
   await confirmPumpReading(card);await card.getByText('✓ Complete',{exact:true}).waitFor();
   const saved=state.reports[key].pumpRows[0];
   assert.equal(saved.opening,expected);assert.equal(saved.closing,expected);assert.equal(saved.readingConfirmed,true);
   assert.equal(saved.ocr_detected_reading,expected);assert.equal(saved.ocr_result.formatProfile,MABOLO_TOTALIZER_FORMAT_ID);
   assert.equal(state.reports[key].confirmed,false);assert.equal(uploads.size,1);assert.deepEqual(errors,[]);
   await card.screenshot({path:'test-output/mabolo-profile-camera.png'});
  }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
 });
