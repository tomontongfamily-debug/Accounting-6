import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import fs from 'node:fs';

test('Cash conflict offers a refresh that keeps quantities and permits a reviewed retry',async()=>{
 const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{CashConfirmation}from'/src/upgrade-components.jsx';import{recoverCashDraft}from'/src/cash-recovery.js';
 window.__fueltechPilotConfig={mode:'shadow',start_date:'2026-10-03'};
 function Demo(){const[report,setReport]=useState({branch:'Liloan',date:'2026-10-03',shiftId:'shift-1',pilotRevision:1,cashDenominations:{1000:81,500:12,100:2,5:9}});return <CashConfirmation report={report} onSaved={setReport} onCountsChange={counts=>setReport({...report,cashDenominations:counts})} onReload={async counts=>setReport(recoverCashDraft({...report,pilotRevision:7,cashDenominations:{},pumpRows:[{readingRevision:4}]},counts))}/>;}createRoot(document.getElementById('root')).render(<Demo/>);`;
 const server=await createServer({server:{host:'127.0.0.1',port:4334,strictPort:true},plugins:[{name:'cash-recovery-test-fixture',resolveId(id){if(id==='/cash-recovery-test.jsx')return id;},load(id){if(id==='/cash-recovery-test.jsx')return entry;}}]});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let attempts=0;
  const html=await server.transformIndexHtml('/cash-recovery-test','<html><head></head><body><div id="root"></div><script type="module" src="/cash-recovery-test.jsx"></script></body></html>');
  await page.route('**/cash-recovery-test',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.route('**/api/pilot/action',async r=>{
   const body=r.request().postDataJSON();attempts++;
   if(attempts===1)return r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'This shift changed on another device. Refresh before saving.'})});
   assert.equal(body.input.report.pilotRevision,7);assert.equal(body.input.denominations[1000],81);
   return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,report:{...body.input.report,pilotRevision:8,cashCountConfirmed:true,actualCashCounted:87245}})});
  });
  await page.goto('http://127.0.0.1:4334/cash-recovery-test');await page.getByRole('button',{name:'Confirm physical cash',exact:true}).click();
  await page.getByRole('button',{name:'Refresh shift, keep my cash count',exact:true}).click();
  assert.equal(await page.getByLabel('End-of-shift cash count ₱1000 quantity',{exact:true}).inputValue(),'81');
  await page.getByRole('button',{name:'Confirm physical cash',exact:true}).click();await page.getByText(/Physical cash confirmed/).waitFor();
  assert.equal(attempts,2);assert.deepEqual(errors,[]);
  fs.mkdirSync('../../work/liloan-photo-cash-review',{recursive:true});await page.locator('.cash-confirmation').screenshot({path:'../../work/liloan-photo-cash-review/cash-recovery-confirmed.png'});
 }finally{await browser.close();await server.close();}
});
