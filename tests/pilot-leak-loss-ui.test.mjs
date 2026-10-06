import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createReport} from '../src/accounting-engine.js';

test('Leak loss keeps saved readings and sales visible on desktop and phone, including submitted reports',async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:4348,strictPort:true}});await server.listen();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const report=createReport('Liloan','2026-10-06',{Premium:89.8,Regular:88.8,Diesel:104.95},'shift-1');
  report.pumpRows=report.pumpRows.map(row=>({...row,opening:10000,closing:10010,closingEntered:true,closingEntrySource:'cashier',photo_path:'/test-pump.svg',readingConfirmed:true,readingRevision:1}));
  const row=report.pumpRows.find(row=>row.pump==='Pump 1'&&row.nozzle==='Regular1');
  row.opening=392555.72;row.closing=392574.09;
  try {
    for(const width of [1280,390]) {
      const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(report=>{window.__leakTestFixture=report;},report);
      await page.route('**/test-pump.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="250" height="100"><text x="20" y="50">392574.09 (test data)</text></svg>'}));
      const html=await server.transformIndexHtml('/leak-loss-test','<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module" src="/tests/leak-loss-ui-fixture.jsx"></script></body></html>');
      await page.route('**/leak-loss-test',route=>route.fulfill({contentType:'text/html',body:html}));
      await page.goto('http://127.0.0.1:4348/leak-loss-test');
      const card=page.locator(`[data-pump-row-id="${row.id}"]`),sales=card.getByLabel('Pump 1 Regular1 sales');
      try {await card.getByText('392,574.09',{exact:true}).waitFor({timeout:5000});}
      catch(error){console.log(JSON.stringify({errors,text:await page.locator('body').innerText()}));throw error;}
      await page.getByRole('button',{name:'Add Fuel Leak Loss',exact:true}).click();
      await page.getByLabel('Leak loss source',{exact:true}).selectOption(row.id);
      await page.getByLabel('Fuel leak loss liters',{exact:true}).fill('5');
      assert.match(await sales.innerText(),/Metered: 18\.37 L/);
      assert.match(await sales.innerText(),/Leak loss: 5\.00 L/);
      assert.match(await sales.innerText(),/Paid sales: 13\.37 L/);
      assert.match(await sales.innerText(),/1,187\.26/);
      assert.match(await page.getByLabel('Confirmed pump sales totals').innerText(),/Paid pump sales:/);
      assert.deepEqual(await page.evaluate(()=>window.leakTestReport.pumpRows),report.pumpRows);
      await page.getByLabel('Fuel leak loss liters',{exact:true}).fill('18.37');
      assert.match(await sales.innerText(),/all metered liters are recorded as loss/);
      await page.getByLabel('Fuel leak loss liters',{exact:true}).fill('230.88');
      assert.match(await sales.innerText(),/Leak loss exceeds the metered liters/);
      assert.match(await page.getByLabel('Confirmed pump sales totals').innerText(),/Check leak loss entries/);
      await card.getByText('392,574.09',{exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.leakTestReport.pumpRows),report.pumpRows);
      await page.getByLabel('Fuel leak loss liters',{exact:true}).fill('5');
      await page.evaluate(()=>window.setLeakTestReport(old=>({...old,confirmed:true})));
      await card.getByText('392,574.09',{exact:true}).waitFor();
      assert.match(await sales.innerText(),/Paid sales: 13\.37 L/);
      assert.equal(await card.getByRole('button',{name:'Yes, confirm reading',exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]);await page.close();
    }
  } finally {await browser.close();await server.close();}
});
