import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';
import {execute} from '../pilot/repository.mjs';
import {stationLoadFixture} from './pilot-station-load-fixture.mjs';

test('Barili and Mabolo desktops load verified saved shifts through the repository while Liloan POS is offline',async()=>{
  const server=await preview({preview:{host:'127.0.0.1',port:4386,strictPort:true}});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const branch of ['Barili','Mabolo']) {
      const f=stationLoadFixture(),context=await browser.newContext({viewport:{width:1366,height:900},timezoneId:'Asia/Manila'}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      const session={role:'Cashier',branch};
      await page.route('**/api/**',async route=>{
        const path=new URL(route.request().url()).pathname;let result,status=200;
        if(path==='/api/pilot/config')result={ok:true,...f.config,launch:{ready:true}};
        else if(path.startsWith('/api/auth/'))result={ok:true,...session,token:'cookie',expiresAt:Date.now()+3600000};
        else if(path==='/api/pilot/action'){
          try{result=await execute(session,route.request().postDataJSON(),f);}
          catch(error){status=error.status||503;result={ok:false,error:error.message};}
        }else result={ok:true,enabled:false};
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
      });
      await page.goto('http://127.0.0.1:4386/cashier');
      await page.getByRole('heading',{name:'Choose a shift',exact:true}).waitFor();
      await expect(page.getByText('Opening setup confirmed',{exact:true})).toBeVisible();
      assert.equal(await page.getByRole('heading',{name:'Unable to Load Saved Reports',exact:true}).count(),0);
      assert.equal(f.stats.fullLoads,0);assert.equal(f.stats.posReads,0);assert.deepEqual(errors,[]);
      await context.close();
    }
  }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
