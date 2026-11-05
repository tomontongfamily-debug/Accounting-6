import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

test('built pilot refresh requests only changes and retains the existing report dashboard',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:4379,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();let {state}=fixture();const inputs=[],errors=[];
  await page.clock.install();
  let holdLoads=false,releaseLoad,activeLoads=0,maxActiveLoads=0;
  page.on('pageerror',e=>errors.push(e.stack));
  await page.route('**/api/**',async request=>{
   const path=new URL(request.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:state.startDate,storage_version:2};
   else if(path==='/api/auth/station-session'){status=401;result={ok:false};}
   else if(path.startsWith('/api/auth/'))result={ok:true,role:'Admin',token:'cookie',branch:'',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){
    const body=request.request().postDataJSON();
    const outcome=await runAction(state,{role:'Admin',branch:''},body.route,body.input);state=outcome.state;result=outcome.result;
    if(body.route==='/api/store/load'){
     activeLoads++;maxActiveLoads=Math.max(maxActiveLoads,activeLoads);
     inputs.push(body.input);
     if(holdLoads)await new Promise(resolve=>{releaseLoad=resolve;});
     result={...result,storeRevision:7,storeScope:'Admin',delta:body.input.sinceRevision===7};
     if(result.delta)result.reportRows=[];
    }
   }else {status=404;result={ok:false,error:'Unmocked API route'};}
   await request.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   if(path==='/api/pilot/action'&&request.request().postDataJSON().route==='/api/store/load')activeLoads--;
  });
  await page.goto('http://127.0.0.1:4379/pilot/admin');
  await page.getByRole('button',{name:'Error Analytics',exact:true}).first().waitFor({timeout:8000}).catch(async error=>{throw Error(JSON.stringify({body:await page.locator('body').innerText(),inputs,errors,reason:error.message}));});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const deadline=Date.now()+10000;while(!inputs.some(input=>input.sinceRevision===7)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  assert.ok(inputs.some(input=>input.sinceRevision===7&&input.storeScope==='Admin'),JSON.stringify({inputs,errors}));
  await expect.poll(()=>activeLoads).toBe(0);
  holdLoads=true;const before=inputs.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>inputs.length).toBe(before+1);
  for(let i=0;i<10;i++)await page.evaluate(()=>{
   window.dispatchEvent(new Event('focus'));
   window.dispatchEvent(new Event('online'));
   window.dispatchEvent(new Event('fueltech-pilot-change'));
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(15000);
  assert.equal(inputs.length,before+1);assert.equal(maxActiveLoads,1);
  holdLoads=false;releaseLoad();
  await expect.poll(()=>inputs.length).toBe(before+2);
  await expect.poll(()=>activeLoads).toBe(0);
  assert.equal(maxActiveLoads,1);
  await page.getByRole('button',{name:'Error Analytics',exact:true}).first().waitFor();
  assert.equal(await page.getByText('Unable to Load Saved Reports',{exact:true}).count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
