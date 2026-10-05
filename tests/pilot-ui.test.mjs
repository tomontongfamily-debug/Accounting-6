import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { fixture } from './pilot-fixture.mjs';
import { runAction } from '../pilot/service.mjs';

test('Built pilot loads cashier/manager/admin and phone capture views without runtime errors',async()=>{
  const server=await preview({preview:{host:'127.0.0.1',port:4329,strictPort:true}});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    for(const [role,width] of [['Cashier',1280],['Cashier',390],['Manager',1280],['Manager',390],['Admin',1280],['Approver',1280]]) {
      const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Asia/Manila'});
      const page=await context.newPage(),errors=[];let {state}=fixture();
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/api/**',async request=>{
        const path=new URL(request.request().url()).pathname;
        let result,status=200;
        if(path==='/api/pilot/config') result={ok:true,mode:'shadow',start_date:'2026-09-23'};
        else if(path==='/api/auth/station-session'){status=401;result={ok:false};}
    else if(path.startsWith('/api/auth/')) result={ok:true,role,token:'cookie',branch:'Liloan',expiresAt:Date.now()+3600000};
        else if(path==='/api/pilot/action') {
          const body=request.request().postDataJSON();
          try {const outcome=await runAction(state,{role,branch:'Liloan'},body.route,body.input);state=outcome.state;result=outcome.result;}
          catch(e){status=e.status||400;result={ok:false,error:e.message};}
        } else {status=404;result={ok:false,error:'Unmocked API route'};}
        await request.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
      });
      await page.goto('http://127.0.0.1:4329/pilot/'+role.toLowerCase());
      if(['Cashier','Manager'].includes(role)) {
        await page.getByLabel('Six-digit branch PIN').fill('000000');await page.getByRole('button',{name:'Proceed',exact:true}).click();
      } else if(role==='Approver') {
        await page.locator('input[type=password]').fill('test-only');await page.getByRole('button',{name:'Open Bank Verification'}).click();
      }
      await page.getByText('Loading Saved Reports',{exact:true}).waitFor({state:'hidden',timeout:10000});
      if(role==='Cashier'&&width===390) await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
      if(role==='Admin') await page.getByRole('button',{name:'Error Analytics',exact:true}).first().waitFor();
      assert.equal((await page.getByText('Unable to Load Saved Reports',{exact:true}).count()),0);
      assert.deepEqual(errors,[],`${role} ${width}: ${errors.join(';')}`);
      await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
