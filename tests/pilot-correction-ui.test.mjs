import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { correctionFixture, correctionDatabase } from './correction-fixture.mjs';
import { saveLivePilotCorrection } from '../pilot/repository.mjs';
import { runAction } from '../pilot/service.mjs';

test('Admin decisions show failed saves honestly, persist after reload, and open editable phone pump readings',async()=>{
  const server=await preview({preview:{host:'127.0.0.1',port:4346,strictPort:true}});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const f=correctionFixture();f.state.mode='live';
  const previousKey=f.key;f.key='Liloan__2026-10-05__shift-1';f.report.date='2026-10-05';
  f.state.reports[f.key]={...f.state.reports[previousKey],date:f.report.date};delete f.state.reports[previousKey];
  f.state.reports[f.key].correctionRequest.reportDate=f.report.date;
  for(const photo of Object.values(f.state.photos))if(photo.reportKey===previousKey)photo.reportKey=f.key;
  f.state.deposits[0].anchorKey=f.key;f.state.deposits[0].coveredReportKeys=[f.key];
  const db=correctionDatabase(f.state);
  const errors=[];let attempts=0,staleAttempts=0,currentPage;
  const output=path.resolve('../../outputs/liloan-correction-approval-review');fs.mkdirSync(output,{recursive:true});
  async function setup(context,role) {
    const page=await context.newPage();currentPage=page;page.on('pageerror',e=>errors.push(e.stack));
    await page.route('**/api/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      let result,status=200;
      if(pathname.startsWith('/api/auth/'))result={ok:true,role,branch:role==='Admin'?'':'Liloan',token:'cookie',expiresAt:Date.now()+3600000};
      else if(pathname==='/api/pilot/config')result={ok:true,mode:'live',start_date:f.state.startDate};
      else if(pathname==='/api/reports/save') {
        const input=route.request().postDataJSON();
        if(input.operation==='save') {
          staleAttempts++;
          try {result=await saveLivePilotCorrection(db,f.admin,input.report,input.operation);}
          catch(error){status=error.status;result={ok:false,error:error.message,staleDraft:error.staleDraft};}
        } else {
          attempts++;assert.equal(input.operation,'correction-decision');
          if(attempts===1){status=409;result={ok:false,error:'Test save conflict: approval was not saved.'};}
          else result=await saveLivePilotCorrection(db,f.admin,input.report,input.operation);
        }
      } else if(pathname==='/api/pilot/action') {
        const envelope=route.request().postDataJSON();
        const out=await runAction(db.data,{role,branch:'Liloan'},envelope.route,envelope.input);result=out.result;
      } else if(pathname==='/api/store/load')result=(await runAction(db.data,f.admin,'/api/store/load')).result;
      else if(pathname==='/api/realtime/config')result={ok:true,enabled:false};
      else if(pathname==='/api/pilot/photo'){await route.fulfill({status:200,contentType:'image/jpeg',body:Buffer.from('/9j/2Q==','base64')});return;}
      else result={ok:true,checkedAt:new Date().toISOString(),alerts:[],push:{ready:false}};
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
    });return page;
  }
  try {
    const adminContext=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Manila'});
    const obsoleteApproval={...f.report,confirmed:false,clientSave:{branchDataVersion:'2026-07-31-rewind-to-july-30-1'},correctionRequest:{...f.report.correctionRequest,id:'obsolete-request',status:'approved'}};
    await adminContext.addInitScript(({key,report})=>{
      if(localStorage.getItem('correction-queue-fixture'))return;
      localStorage.setItem('correction-queue-fixture','true');
      for(const storageKey of ['fueltech-report-offline-queue-v2','fueltech-report-local-drafts-v1'])localStorage.setItem(storageKey,JSON.stringify({[key]:report}));
    },{key:f.key,report:obsoleteApproval});
    const admin=await setup(adminContext,'Admin');
    await admin.goto('http://127.0.0.1:4346/admin?view=corrections');
    await admin.getByRole('button',{name:'Approve',exact:true}).waitFor({timeout:15000});
    assert.equal(staleAttempts,1);
    assert.equal(await admin.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('fueltech-report-offline-queue-v2'))).length),0);
    assert.equal(await admin.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('fueltech-report-local-drafts-v1'))).length),0);
    await admin.getByRole('button',{name:'Approve',exact:true}).click();
    await admin.getByRole('alert').filter({hasText:'Test save conflict'}).waitFor();
    assert.equal(db.data.reports[f.key].correctionRequest.status,'pending');
    assert.equal(await admin.getByRole('button',{name:'Approve',exact:true}).isEnabled(),true);
    assert.equal(await admin.getByRole('button',{name:'Approved',exact:true}).count(),0);
    await admin.getByRole('button',{name:'Approve',exact:true}).click();
    await admin.getByRole('button',{name:'Approved',exact:true}).waitFor();
    assert.equal(await admin.getByRole('button',{name:'Approved',exact:true}).isEnabled(),false);
    assert.equal(db.data.reports[f.key].correctionRequest.status,'approved');
    assert.equal(db.mirrored[f.key].confirmed,false);
    await admin.reload();await admin.getByRole('button',{name:'Approved',exact:true}).waitFor();
    await admin.screenshot({path:path.join(output,'admin-approved.png'),fullPage:true});
    const phoneContext=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Manila'});
    const phone=await setup(phoneContext,'Cashier');
    await phone.goto('http://127.0.0.1:4346/pilot/cashier');
    if(await phone.getByLabel('Six-digit branch PIN').count()) {
      await phone.getByLabel('Six-digit branch PIN').fill('000000');await phone.getByRole('button',{name:'Proceed',exact:true}).click();
    }
    await phone.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
    await phone.getByRole('button',{name:'Open approved correction',exact:true}).waitFor();
    assert.equal(await phone.getByLabel('Shift to photograph').inputValue(),f.key);
    await phone.getByRole('button',{name:'Retake photo',exact:true}).first().waitFor();
    assert.equal(await phone.getByRole('button',{name:'Edit number',exact:true}).first().isEnabled(),true);
    await phone.screenshot({path:path.join(output,'phone-correction.png'),fullPage:true});
    assert.equal(db.data.reports[f.key].actualCashCounted,500);assert.equal(db.data.deposits[0].amount,500);
    assert.deepEqual(errors,[]);assert.equal(attempts,2);
    await adminContext.close();await phoneContext.close();
  } catch(error) {
    await currentPage.screenshot({path:path.join(output,'test-failure.png'),fullPage:true});
    console.log(JSON.stringify({attempts,errors,text:await currentPage.locator('body').innerText()}));throw error;
  } finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
