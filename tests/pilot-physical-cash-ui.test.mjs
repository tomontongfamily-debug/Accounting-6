import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

test('Two open cash screens survive phone and draft saves; identical cash confirmation reloads the locked count',async()=>{
 let {state,report,key,cashier}=fixture();
 const initial={...report,cashDenominations:{1000:81,500:12,100:2,5:9}};
 const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{CashConfirmation}from'/src/upgrade-components.jsx';
 window.__fueltechPilotConfig={mode:'shadow',start_date:'2026-09-23'};
 function Demo(){const[report,setReport]=useState(window.__cashFixture);return <CashConfirmation report={report} onSaved={setReport} onCountsChange={cashDenominations=>setReport({...report,cashDenominations})}/>;}createRoot(document.getElementById('root')).render(<Demo/>);`;
 const server=await createServer({cacheDir:'node_modules/.vite-physical-cash-test',server:{host:'127.0.0.1',port:4337,strictPort:true},plugins:[{name:'physical-cash-fixture',resolveId(id){if(id==='/physical-cash-fixture.jsx')return id;},load(id){if(id==='/physical-cash-fixture.jsx')return entry;}}]});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const html=await server.transformIndexHtml('/physical-cash-fixture','<html><head></head><body><div id="root"></div><script type="module" src="/physical-cash-fixture.jsx"></script></body></html>');
  const pages=[],errors=[],statuses=[];
  for(let i=0;i<2;i++){
   const page=await browser.newPage({viewport:{width:1100,height:1100}});pages.push(page);
   await page.addInitScript(value=>window.__cashFixture=value,initial);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/physical-cash-fixture',r=>r.fulfill({contentType:'text/html',body:html}));
   await page.route('**/api/pilot/action',async request=>{
    const body=request.request().postDataJSON();let result,status=200;
    try{const out=await runAction(state,cashier,body.route,body.input);state=out.state;result=out.result;}catch(e){status=e.status||400;result={ok:false,error:e.message};}
    statuses.push(status);await request.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   await page.goto('http://127.0.0.1:4337/physical-cash-fixture');await page.getByRole('button',{name:'Confirm physical cash',exact:true}).waitFor();
  }
  // Both desktop tabs are now stale. The phone confirms a real nozzle field,
  // and another draft save changes a separate field before cash confirmation.
  const row=report.pumpRows[0],path='/api/pilot/photo?id=phone-test';state.photos[path]={branch:'Liloan',reportKey:key,rowId:row.id};
  state=(await runAction(state,cashier,'/api/demo/pump-reading',{reportKey:key,revision:0,row:{...row,closing:Number(row.opening)+10,closingEntered:true,readingConfirmed:true,photo_path:path}})).state;
  state=(await runAction(state,cashier,'/api/reports/save',{report:{...state.reports[key],notes:'Other saved draft'}})).state;
  for(const page of pages){
   await page.getByRole('button',{name:'Confirm physical cash',exact:true}).click();await page.getByText(/Physical cash confirmed/).waitFor();
   assert.equal(await page.getByRole('alert').count(),0);
   assert.equal(await page.getByLabel('End-of-shift cash count ₱1000 quantity',{exact:true}).isDisabled(),true);
  }
  assert.deepEqual(statuses,[200,200]);assert.deepEqual(errors,[]);
  assert.equal(state.reports[key].actualCashCounted,87245);assert.equal(state.reports[key].notes,'Other saved draft');
  assert.equal(state.reports[key].pumpRows[0].photo_path,path);
  assert.equal(state.audit.filter(a=>a.action==='cash-confirm').length,1);
 }finally{await browser.close();await server.close();}
});
