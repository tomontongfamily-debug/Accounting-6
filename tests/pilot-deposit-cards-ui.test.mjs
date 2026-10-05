import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

test('Manager and admin cards identify covered shifts; manager records bank fees separately from the remaining difference',async()=>{
  const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ManagerDepositCards}from'/src/deposit-cards.jsx';import{AdminDepositCards}from'/src/admin-deposits.jsx';import{DepositHistoryCard}from'/src/upgrade-components.jsx';import'/src/styles.css';
    async function api(route,input){if(route==='deposit-submit'){window.__submitted=input;return{ok:true};}return window.__deposits;}
    createRoot(document.getElementById('root')).render(window.__role==='Manager'?<ManagerDepositCards branch="Liloan" api={api} HistoryCard={DepositHistoryCard}/>:<AdminDepositCards branch="Liloan" role="Admin" api={api} HistoryCard={DepositHistoryCard}/>);`;
  const server=await createServer({cacheDir:'node_modules/.vite-deposit-cards-test',server:{host:'127.0.0.1',port:4362,strictPort:true},plugins:[{name:'deposit-card-fixture',resolveId(id){if(id==='/deposit-card-fixture.jsx')return id;},load(id){if(id==='/deposit-card-fixture.jsx')return entry;}}]});
  await server.listen();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const fixture={noDepositDays:[],coverage:{reports:[{key:'Liloan__2026-10-05__shift-1',date:'2026-10-05',shiftId:'shift-1',cash:1000}],carryoverSourceIds:[]},deposits:['03','04'].flatMap(day=>[1,2,3].map(shift=>({id:`${day}-${shift}`,branch:'Liloan',depositDate:'2026-10-05',bank:'PNB',reference:`TEST-${day}-${shift}`,amount:1000,coveredCash:1000,expected:1000,previousCarryover:0,carryoverRemaining:0,unexplainedDifference:0,adjustments:[],status:'pending',manager:'Test manager',coveredReportKeys:[`Liloan__2026-10-${day}__shift-${shift}`],carryoverSourceIds:[]})))};
  const errors=[];
  try{
    const html=await server.transformIndexHtml('/deposit-card-fixture','<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/deposit-card-fixture.jsx"></script></body></html>');
    for(const [role,width] of [['Manager',1280],['Manager',390],['Admin',390]]){
      const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'Asia/Manila'});
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({fixture,role})=>{window.__deposits=fixture;window.__role=role;},{fixture,role});
      await page.route('**/deposit-card-fixture',r=>r.fulfill({contentType:'text/html',body:html}));
      await page.goto('http://127.0.0.1:4362/deposit-card-fixture');
      const cards=page.locator('button.deposit-shift-card.saved');await cards.first().waitFor();
      assert.equal(await cards.count(),6);
      for(let i=0;i<6;i++){
        const card=cards.nth(i),row=fixture.deposits[5-i];
        await card.getByText(`Oct ${Number(row.id.slice(0,2))}, 2026`,{exact:true}).waitFor();
        assert.match(await card.locator('.deposit-covered-shifts').innerText(),new RegExp(`Shift ${row.id.slice(-1)} · `));
        assert.match(await card.innerText(),/Bank deposit date: Oct 5, 2026/);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      if(process.env.FUELTECH_DEPOSIT_SCREENSHOT_DIR){
        await fs.mkdir(process.env.FUELTECH_DEPOSIT_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.FUELTECH_DEPOSIT_SCREENSHOT_DIR,`${role.toLowerCase()}-${width}.png`),fullPage:true});
      }
      await cards.last().click();
      await page.locator('.deposit-history header').getByText('Liloan · Oct 3, 2026',{exact:true}).waitFor();
      assert.match(await page.locator('.deposit-history .deposit-covered-shifts').innerText(),/Shift 1 · 4am–1pm/);
      await page.getByRole('button',{name:'← Back to deposit cards',exact:true}).click();
      if(role==='Manager'&&width===1280){
        await page.getByRole('checkbox',{name:'Select Oct 5, 2026 Shift 1',exact:true}).check();
        await page.getByRole('button',{name:'Create deposit (1) →',exact:true}).click();
        await page.getByText('Bank fees / transportation (optional)',{exact:true}).click();
        await page.getByRole('button',{name:'Add bank fee',exact:true}).click();
        await page.getByLabel('Expense 1 amount',{exact:true}).fill('180');
        await page.getByRole('button',{name:'Add transportation',exact:true}).click();
        await page.getByLabel('Expense 2 amount',{exact:true}).fill('20');
        await page.getByLabel('Reference number',{exact:true}).fill('TEST-FEES');
        await page.getByLabel('Amount deposited',{exact:true}).fill('800');
        await page.getByRole('button',{name:'Review deposit →',exact:true}).click();
        await page.getByText('✓ The deposit amount matches the selected cash after expenses.',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Submit for bank verification',exact:true}).click();
        await page.getByText(/Deposit sent for bank verification/).waitFor();
        const submitted=await page.evaluate(()=>window.__submitted);
        assert.deepEqual(submitted.coveredReportKeys,['Liloan__2026-10-05__shift-1']);
        assert.equal(submitted.reviewedCoveredCash,1000);
        assert.deepEqual(submitted.adjustments.map(a=>[a.type,a.amount]),[['BANK_FEE','180'],['TRANSPORTATION','20']]);
        assert.equal(submitted.amount,'800');
      }
      await page.close();
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});
