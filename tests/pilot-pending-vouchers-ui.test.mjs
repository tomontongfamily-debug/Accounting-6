import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {normalizeSources} from '../pilot/integrations.mjs';
import {reconcileSources} from '../pilot/state.mjs';
import {runAction} from '../pilot/service.mjs';
import {compute} from '../src/accounting-engine.js';

test('pending cash and fuel CVs appear by deductions and reconciliation; refresh removes approved notices without changing counted cash',async()=>{
 const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AutomaticVouchers}from'/src/cash-denominations.jsx';import{CashConfirmation,demoApi}from'/src/upgrade-components.jsx';import'/src/styles.css';window.__fueltechPilotConfig={mode:'shadow',start_date:'2026-09-23'};function Demo(){const[report,setReport]=useState(window.__pendingReport);async function refresh(){const data=await demoApi('cv-status',{reportKey:report.branch+'__'+report.date+'__'+report.shiftId});setReport(data.report);}return <><AutomaticVouchers report={report} onRefresh={refresh}/><CashConfirmation report={report} onSaved={setReport} review onRefreshVouchers={refresh}/></>;}createRoot(document.getElementById('root')).render(<Demo/>);`;
 const server=await createServer({cacheDir:'node_modules/.vite-pending-vouchers-test',server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'pending-fixture',resolveId(id){if(id==='/pending-fixture.jsx')return id;},load(id){if(id==='/pending-fixture.jsx')return entry;}}]});await server.listen();
 const port=server.httpServer.address().port,html=await server.transformIndexHtml('/pending-fixture','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/pending-fixture.jsx"></script></body></html>');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const width of [1280,390]){
  let {state,key,cashier}=fixture();const report=state.reports[key];report.confirmed=true;report.cashCountConfirmed=true;report.actualCashCounted=1000;
  report.pumpRows.forEach(r=>{r.closing=Number(r.opening)+10;r.closingEntered=true;});
  const base={station:'liloan',status:'pending',created_at:'2026-09-23T05:00:00+08:00',category:{name:'OPEX'},funding_allocations:[{date:'2026-09-23',shiftId:'shift-1',amount:500}]};
  const vouchers=[{...base,id:'cash-pending',ref:'SCV-CASH-TEST',payment_method:'cash',amount:500},{...base,id:'fuel-pending',ref:'SCV-FUEL-TEST',payment_method:'fuel',amount:300,fuel_product:'Diesel',fuel_liters:5,funding_allocations:[{date:'2026-09-23',shiftId:'shift-1',amount:300}]}];
  reconcileSources(state,normalizeSources({cv:vouchers},state.startDate));
  const before=compute(state.reports[key]),initial=(await runAction(state,cashier,'/api/demo/cv-status',{reportKey:key})).result.report;
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(report=>window.__pendingReport=report,initial);
  await page.route('**/pending-fixture',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.route('**/api/pilot/action',async route=>{const body=route.request().postDataJSON();assert.equal(body.route,'/api/demo/cv-status');reconcileSources(state,normalizeSources({cv:vouchers.map(v=>({...v,status:'approved'}))},state.startDate));const out=await runAction(state,cashier,body.route,body.input);state=out.state;await route.fulfill({contentType:'application/json',body:JSON.stringify(out.result)});});
  await page.goto(`http://127.0.0.1:${port}/pending-fixture`);
  await expect(page.getByRole('heading',{name:'Pending CV approvals (2)',exact:true})).toHaveCount(2);
  await expect(page.getByText('SCV-CASH-TEST',{exact:true})).toHaveCount(2);
  await expect(page.getByText('SCV-FUEL-TEST',{exact:true})).toHaveCount(2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.getByRole('button',{name:'Refresh CV approvals',exact:true}).first().click();
  await expect(page.getByText('No pending cash or fuel CVs assigned to this shift.',{exact:true})).toHaveCount(2);
  assert.equal(state.reports[key].actualCashCounted,1000);assert.equal(before.expectedCash-compute(state.reports[key]).expectedCash,800);
  assert.equal(state.reports[key].purchaseRows.length,1);assert.equal(state.reports[key].cvFuelRows.length,1);
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();await server.close();}
});
