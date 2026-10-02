import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {preview} from 'vite';
import fs from 'node:fs';
test('Launch notice explains the Shift 3 opening and the guide fits phone and PC',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:4330,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const width of [390,1100]){
   const page=await browser.newPage({viewport:{width,height:900}});let actions=0;
   await page.route('**/api/**',async route=>{if(route.request().url().includes('/action'))actions++;await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,mode:'live',start_date:'2026-10-03',launch:{ready:false,timeReached:false,openingReady:false,openingDate:'2026-10-02'}})});});
   await page.goto('http://127.0.0.1:4330/pilot/cashier');await page.getByRole('heading',{name:'Liloan fresh start'}).waitFor();
   assert.equal(actions,0);assert.match(await page.locator('body').innerText(),/2026-10-02 Shift 3/);
   await page.getByRole('link',{name:'Read the simple station guide'}).click();await page.getByRole('heading',{name:'Liloan station guide'}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
   fs.mkdirSync('../../work/liloan-guide-preview',{recursive:true});await page.screenshot({path:`../../work/liloan-guide-preview/${width}.png`,fullPage:true});await page.close();
 }}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
