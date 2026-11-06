import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import fs from 'node:fs/promises';

test('desktop and phone managers add/remove shifts, upload one receipt, split 68k and retain unused cash',async()=>{
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ManagerDepositCards}from'/src/deposit-cards.jsx';import{DepositHistoryCard}from'/src/upgrade-components.jsx';import'/src/styles.css';async function api(route,input){const r=await fetch('/allocation-test-api',{method:'POST',body:JSON.stringify({route,input})});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}createRoot(document.getElementById('root')).render(<ManagerDepositCards branch="Moalboal" api={api} HistoryCard={DepositHistoryCard}/>);`;
 const server=await createServer({cacheDir:'node_modules/.vite-deposit-allocation-test',server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'allocation-test',resolveId(id){if(id==='/allocation-test.jsx')return id;},load(id){if(id==='/allocation-test.jsx')return entry;}}]});await server.listen();
 const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/allocation-test`;
 const html=await server.transformIndexHtml('/allocation-test','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/allocation-test.jsx"></script></body></html>');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of [1280,390]){
   let {state,report}=fixture();state.branches=['Moalboal'];state.reports={};
   const keys=[];
   for(const [i,cash] of [40000,30000,25000].entries()){const r={...structuredClone(report),branch:'Moalboal',shiftId:'shift-'+(i+1),confirmed:true,actualCashCounted:cash};const key=`Moalboal__${r.date}__${r.shiftId}`;state.reports[key]=r;keys.push(key);}
   const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'Asia/Manila'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/allocation-test',route=>route.fulfill({contentType:'text/html',body:html}));
   await page.route('**/allocation-test-api',async route=>{const {route:path,input}=route.request().postDataJSON();try{const out=await runAction(state,{role:'Manager',branch:'Moalboal'},'/api/demo/'+path,input,{uploadPhoto:async()=>{}});state=out.state;await route.fulfill({contentType:'application/json',body:JSON.stringify(out.result)});}catch(e){await route.fulfill({status:e.status||400,contentType:'application/json',body:JSON.stringify({error:e.message})});}});
   await page.goto(url);
   await page.getByRole('checkbox',{name:'Select Sep 23, 2026 Shift 1',exact:true}).check();
   await page.getByRole('button',{name:'Create deposit (1) →',exact:true}).click();
   await page.getByLabel('Add a shift',{exact:true}).selectOption(keys[1]);
   await page.getByLabel('Add a shift',{exact:true}).selectOption(keys[2]);
   await page.getByRole('button',{name:'Remove Sep 23, 2026 Shift 2',exact:true}).click();
   assert.equal(await page.getByLabel('Amount from Sep 23, 2026 Shift 2',{exact:true}).count(),0);
   await page.getByLabel('Add a shift',{exact:true}).selectOption(keys[1]);
   await page.getByLabel('Amount deposited',{exact:true}).fill('68000');
   for(const [i,value]of ['30000','20000','18000'].entries())await page.getByLabel('Amount from Sep 23, 2026 Shift '+(i+1),{exact:true}).fill(value);
   const review=page.getByRole('button',{name:'Review deposit →',exact:true});assert.equal(await review.isDisabled(),true);
   const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=300;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,500,300);x.fillStyle='black';x.font='24px sans-serif';x.fillText('TEST RECEIPT PHP 68,000',20,50);return c.toDataURL('image/jpeg').split(',')[1];});
   await page.getByLabel('Receipt photo',{exact:true}).setInputFiles({name:'receipt.jpg',mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')});
   await page.getByText(/Receipt saved/).waitFor();await expect(review).toBeEnabled();
   await page.getByLabel('Amount deposited',{exact:true}).fill('68001');await expect(review).toBeDisabled();
   await page.getByLabel('Amount deposited',{exact:true}).fill('68000');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
   if(process.env.FUELTECH_DEPOSIT_SCREENSHOT_DIR){await fs.mkdir(process.env.FUELTECH_DEPOSIT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.FUELTECH_DEPOSIT_SCREENSHOT_DIR+`/allocation-${width}.png`,fullPage:true});}
   await review.click();await page.getByRole('button',{name:'Submit for bank verification',exact:true}).click();
   await page.getByText(/Deposit sent for bank verification/).waitFor();
   assert.equal(state.deposits.length,1);assert.equal(state.deposits[0].amount,68000);assert.deepEqual(state.deposits[0].reportAllocations.map(a=>a.amount),[30000,20000,18000]);
   const cards=page.locator('label.deposit-shift-card');await expect(cards).toHaveCount(3);
   for(const [i,value]of ['₱10,000.00','₱10,000.00','₱7,000.00'].entries())assert.equal(await cards.nth(i).locator('.deposit-card-amount').innerText(),value);
   await page.locator('button.deposit-shift-card.saved').click();await page.getByRole('link',{name:'View bank receipt',exact:true}).waitFor();
   assert.match(await page.locator('.deposit-history').innerText(),/Only the assigned cash is reserved/);
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();await server.close();}
});
