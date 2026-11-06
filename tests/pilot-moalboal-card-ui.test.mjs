import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {createReport,compute} from '../src/accounting-engine.js';
import {runAction} from '../pilot/service.mjs';

test('built cashier screen offers a separate terminal card total only in Moalboal and saves it through the real service',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:false}});
 const port=server.httpServer.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const branch of ['Moalboal','Pondol']){
   let {state}=fixture();state.mode='live';state.startDate='2026-10-03';state.stationStarts={[branch]:'2026-11-05'};state.branches=[branch];state.priceBook[branch]={'2026-11-05':{Premium:70,Regular:65,Diesel:60}};state.reports={};
   for(const [date,shift,confirmed]of [['2026-11-04','shift-3',true],['2026-11-05','shift-1',false]]){
    const r=createReport(branch,date,{Premium:70,Regular:65,Diesel:60},shift),key=`${branch}__${date}__${shift}`;
    Object.assign(r,{pilot:true,confirmed,baselineReport:confirmed,baselineConfirmed:true,baselineMissing:false,openingSetupComplete:confirmed,cashierName:'Test cashier',cashCountConfirmed:true,actualCashCounted:1000,pilotRevision:1});
    r.pumpRows=r.pumpRows.map((p,i)=>({...p,opening:10000+i*1000,closing:10000+i*1000+(confirmed?0:10),closingEntered:true,readingConfirmed:true,photo_path:'/api/pilot/photo?id='+p.id}));
    state.reports[key]=r;
    for(const p of r.pumpRows)state.photos[p.photo_path]={branch,reportKey:key,rowId:p.id};
   }
   const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-11-05T02:00:00Z')});
   await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let result,status=200;
    if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
    if(path==='/api/pilot/config')result={ok:true,mode:'live',start_date:state.startDate,branches:[branch],stationStarts:state.stationStarts};
    else if(path.startsWith('/api/auth/'))result={ok:true,role:'Cashier',branch,token:'cookie',expiresAt:Date.now()+3600000};
    else if(path==='/api/pilot/action'){const body=route.request().postDataJSON();try{const out=await runAction(state,{role:'Cashier',branch},body.route,body.input,{mutationId:body.mutationId});state=out.state;result=out.result;}catch(e){status=e.status||400;result={ok:false,error:e.message};}}
    else result={ok:true,enabled:false};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   await page.goto(`http://127.0.0.1:${port}/pilot/cashier`);
   await page.locator('.cashier-shift-card').first().waitFor();
   await page.locator('.cashier-shift-card').first().click({timeout:5000});
   await page.getByRole('button',{name:'Open Payments, Deductions and Other Sales',exact:true}).click();
   const input=page.getByLabel('Debit / credit card',{exact:true});
   if(branch==='Moalboal'){
    await input.fill('7029.90');
    await expect.poll(()=>Number(state.reports[`${branch}__2026-11-05__shift-1`].deductions.bankCard)).toBe(7029.90);
    const r=state.reports[`${branch}__2026-11-05__shift-1`];assert.equal(compute(r).deductionTotal,7029.90);assert.equal(r.onlinePay.total,0);
   }else assert.equal(await input.count(),0);
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
