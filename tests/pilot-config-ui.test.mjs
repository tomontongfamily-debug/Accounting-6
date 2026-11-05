import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {preview} from 'vite';

test('configuration failures allow retry and preserve entered information on phone and desktop',async()=>{
  const server=await preview({preview:{host:'127.0.0.1',port:4376,strictPort:true}});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    for(const viewport of [{width:390,height:844},{width:1440,height:900}]) {
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.clock.install();
      let configMode='fail',configCalls=0,authCalls=0;
      await page.route('**/api/**',async route=>{
        const path=new URL(route.request().url()).pathname;let result,status=200;
        if(path==='/api/pilot/config') {
          configCalls++;
          if(configMode==='hang')return;
          if(configMode==='fail'){status=503;result={error:'Temporary connection failure'};}
          else result={ok:true,mode:configMode,start_date:'2026-10-03',launch:{ready:true}};
        }else if(path.startsWith('/api/auth/')){authCalls++;status=401;result={ok:false,error:'Please sign in.'};}
        else result={ok:true,enabled:false};
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
      });
      await page.goto('http://127.0.0.1:4376/cashier');
      await expect(page.getByRole('alert')).toContainText('Unable to check');
      configMode='live';await page.getByRole('button',{name:'Retry connection',exact:true}).click();
      const pin=page.getByRole('textbox',{name:'Six-digit branch PIN',exact:true});
      await pin.fill('123');const mountedAuthCalls=authCalls;
      configMode='fail';
      await page.clock.runFor(15000);
      await expect(page.getByRole('status')).toContainText('Your current screen remains open');
      await expect(pin).toHaveValue('123');assert.equal(authCalls,mountedAuthCalls);
      configMode='live';await page.getByRole('button',{name:'Retry connection',exact:true}).click();
      await expect(page.getByRole('status')).toHaveCount(0);await expect(pin).toHaveValue('123');
      const completedCalls=configCalls;
      configMode='hang';await page.clock.runFor(15000);
      await expect.poll(()=>configCalls).toBe(completedCalls+1);
      const pendingCalls=configCalls;
      await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));});
      assert.equal(configCalls,pendingCalls);
      await page.clock.runFor(15000);
      await expect(page.getByRole('status')).toContainText('Connection check delayed');
      await expect(pin).toHaveValue('123');
      configMode='live';await page.getByRole('button',{name:'Retry connection',exact:true}).click();
      await expect(page.getByRole('status')).toHaveCount(0);await expect(pin).toHaveValue('123');
      // A successful disabling response must still close the app.
      configMode='disabled';await page.clock.runFor(15000);
      await expect(page.getByText('The pilot has not been enabled yet.',{exact:false})).toBeVisible();
      await expect(pin).toHaveCount(0);assert.deepEqual(errors,[]);
      await context.close();
    }
    const context=await browser.newContext(),page=await context.newPage();await page.clock.install();
    await page.route('**/api/pilot/config',()=>{});
    await page.goto('http://127.0.0.1:4376/manager');
    await expect(page.getByText('Checking pilot configuration…',{exact:true})).toBeVisible();
    await page.clock.runFor(15000);
    await expect(page.getByRole('alert')).toContainText('took too long');
    await expect(page.getByRole('button',{name:'Retry connection',exact:true})).toBeEnabled();
    await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
