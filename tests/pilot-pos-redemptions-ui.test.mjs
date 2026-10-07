import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fixture } from './pilot-fixture.mjs';
import { normalizePosRedemptions,refreshPosReport } from '../pilot/pos-redemptions.mjs';
test('Desktop and phone show automatic deductions, points review, safe offline evidence and record IDs',async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:4353,strictPort:true}});await server.listen();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const {report}=fixture();report.deductions.cashRedemption=300;report.deductions.fuelRedemption=1220;
  const rows=normalizePosRedemptions([{WithdrawalId:'00000000-0000-4000-8000-000000000001',WithdrawalDate:'2026-09-23T04:00:00+08:00',Type:'Cash',RedeemedPoints:1461,CokeQuantity:0,OrgCode:'YTL'}],report.date,report.date);
  const source=refreshPosReport(report,{startDate:report.date,status:'verified',verifiedAt:new Date().toISOString(),rows});
  try{
    for(const width of [1280,390]){
      const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(r=>{window.__posFixture=r;},source);
      const html=await server.transformIndexHtml('/pos-evidence-test','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/pos-redemptions-ui-fixture.jsx"></script></body></html>');
      await page.route('**/pos-evidence-test',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('http://127.0.0.1:4353/pos-evidence-test');
      const section=page.getByLabel('POS redemption comparison');await section.waitFor();assert.match(await section.innerText(),/deducted automatically, once/);assert.match(await section.innerText(),/1,461\.00/);assert.match(await section.innerText(),/Needs POS review/);assert.ok(!(await section.innerText()).includes('₱1,520.00'));
      await section.getByText('View 1 POS records').click();assert.match(await section.innerText(),/00000000-0000-4000-8000-000000000001/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      if(process.env.POS_UI_ARTIFACT_DIR){mkdirSync(process.env.POS_UI_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:`${process.env.POS_UI_ARTIFACT_DIR}/pos-${width}.png`,fullPage:true});}
      await page.getByRole('button',{name:'Simulate unavailable POS',exact:true}).click();assert.match(await section.innerText(),/POS is unavailable/);assert.match(await section.innerText(),/1,461\.00/);
      await page.getByRole('button',{name:'Simulate no verified copy',exact:true}).click();assert.match(await section.innerText(),/does not mean zero redemptions/);assert.ok(!(await section.innerText()).includes('₱1,461.00'));assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser.close();await server.close();}
});
