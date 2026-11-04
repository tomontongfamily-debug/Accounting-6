import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {runAction} from '../pilot/service.mjs';
import {ALL_STATIONS,withStationRollout} from '../src/station-rollout.js';

test('all five new stations can open tonight’s setup on a phone; failed Admin loads show an error',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-04T22:05:00+08:00')});
 const server=await preview({preview:{host:'127.0.0.1',port:4361,strictPort:true}});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const branch of ALL_STATIONS.filter(b=>b!=='Liloan')){
   const f=fixture();let state=f.state;state.mode='live';state.startDate='2026-10-03';
   const config=withStationRollout({ok:true,mode:'live',start_date:state.startDate,launch:{ready:true}});
   prepareStationRollout(state,config);
   const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Manila'});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.clock.install({time:new Date('2026-11-04T05:00:00Z')});
   await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let result,status=200;
    if(path==='/api/pilot/config')result=config;
    else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',branch,token:'cookie',expiresAt:Date.now()+3600000};
    else if(path==='/api/pilot/action'){
     const body=route.request().postDataJSON();
     try{const out=await runAction(state,{role:'Cashier',branch},body.route,body.input);state=out.state;result=out.result;}
     catch(e){status=e.status||400;result={ok:false,error:e.message};}
    }else result={ok:true,enabled:false};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   await page.goto('http://127.0.0.1:4361/cashier');
   await page.getByRole('heading',{name:'Choose a shift',exact:true}).waitFor();
   assert.match(await page.locator('.cashier-opening-card').innerText(),/2026-11-04/);
   assert.match(await page.locator('.cashier-shift-heading').innerText(),new RegExp(branch+' - 2026-11-05'));
   assert.equal(await page.locator('.cashier-shift-card').first().isDisabled(),true);
   await page.locator('.cashier-opening-card').click();
   await page.getByRole('heading',{name:'Opening Setup - Starting Readings',exact:true}).waitFor();
   await page.getByLabel('Setup Cashier Name',{exact:true}).fill('Test '+branch);
   assert.equal(await page.getByRole('button',{name:'Confirm Opening Setup',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('heading',{name:'Pump photos',exact:true}).count(),0);
   await page.clock.setFixedTime(new Date('2026-11-04T14:05:00Z'));
   for(const input of await page.locator('input[inputmode="decimal"]').all())await input.fill('0');
   await page.getByRole('button',{name:'Confirm Opening Setup',exact:true}).click();
   await expect.poll(()=>state.reports[branch+'__2026-11-04__shift-3'].confirmed).toBe(true);
   await page.getByRole('button',{name:'Back to Shifts',exact:true}).first().click();
   await page.getByText('Opening setup confirmed',{exact:true}).waitFor();
   assert.equal(await page.locator('.cashier-shift-card').first().isDisabled(),true);
   assert.deepEqual(errors,[]);await context.close();
  }
  const context=await browser.newContext(),page=await context.newPage();
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   const result=path==='/api/pilot/config'?withStationRollout({ok:true,mode:'live',start_date:'2026-10-03',launch:{ready:true}}):path.startsWith('/api/auth/')?{ok:true,role:'Admin',branch:'',token:'cookie',expiresAt:Date.now()+3600000}:{ok:false,error:'Archive test: database unavailable'};
   await route.fulfill({status:result.ok?200:503,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:4361/admin');
  await page.getByRole('heading',{name:'Unable to Load Admin Reports',exact:true}).waitFor();
  await page.getByRole('alert').filter({hasText:'database unavailable'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Try Again',exact:true}).isEnabled(),true);
  await context.close();
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
