import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { createReport, reportKey } from '../src/accounting-engine.js';
import { initialState } from '../pilot/state.mjs';
import { runAction } from '../pilot/service.mjs';

function octoberFixture() {
  const prices={Premium:70,Regular:65,Diesel:60},reports=[];
  const opening=createReport('Liloan','2026-10-02',prices,'shift-3');
  Object.assign(opening,{confirmed:true,baselineConfirmed:true,baselineMissing:false});
  opening.pumpRows=opening.pumpRows.map((row,i)=>({...row,opening:10000+i*1000,closing:10000+i*1000,closingEntered:true}));
  opening.tankRows=opening.tankRows.map(row=>({...row,actualDip:1000}));reports.push(opening);
  let elapsedShifts=0;
  for(const date of ['2026-10-03','2026-10-04','2026-10-05'])for(const shiftId of ['shift-1','shift-2','shift-3']) {
    const r=createReport('Liloan',date,prices,shiftId);
    Object.assign(r,{pilot:true,pilotRevision:1,baselineConfirmed:true,baselineMissing:false,cashierName:'Test cashier',confirmed:date<'2026-10-05'||shiftId==='shift-1'});
    r.pumpRows=r.pumpRows.map((row,i)=>({...row,opening:10000+i*1000+elapsedShifts*10,closing:10010+i*1000+elapsedShifts*10,closingEntered:true,closingEntrySource:'cashier',readingConfirmed:true,photo_path:'/api/pilot/photo?id='+date+shiftId+row.id,readingRevision:1,setupRequired:false}));
    elapsedShifts++;
    reports.push(r);
  }
  const state=initialState(reports.map(data=>({branch:'Liloan',report_key:reportKey(data.branch,data.date,data.shiftId),data})),[{branch:'Liloan',effective_date:'2026-10-02',coverage:'Daily',prices}],{mode:'live',start_date:'2026-10-03'});
  state.sourcesVerifiedAt=new Date().toISOString();
  for(const r of reports.slice(1))for(const row of r.pumpRows)state.photos[row.photo_path]={branch:'Liloan',reportKey:reportKey(r.branch,r.date,r.shiftId),rowId:row.id};
  return state;
}

test('The desktop opens October 5 Shift 2 and retains all eight phone-confirmed readings with the October opening',async()=>{
  const server=await preview({preview:{host:'127.0.0.1',port:4347,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
  const cashier={role:'Cashier',branch:'Liloan'},key='Liloan__2026-10-05__shift-2';
  try {
    for(const missing of [false,true]) {
      let state=octoberFixture();const expectedPumps=structuredClone(state.reports[key].pumpRows),errors=[];
      if(missing) {
        delete state.reports['Liloan__2026-10-02__shift-3'];
        const old={...octoberFixture().reports['Liloan__2026-10-02__shift-3'],date:'2026-07-29',openingSetupComplete:true};
        state.reports['Liloan__2026-07-29__shift-3']=old;
      }
      const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Manila'}),page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install({time:new Date('2026-10-05T14:28:00Z')});
      await page.route('**/api/**',async route=>{
        const path=new URL(route.request().url()).pathname;let result,status=200;
        if(path==='/api/pilot/config')result={ok:true,mode:'live',start_date:'2026-10-03',launch:{ready:true}};
        else if(path.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
        else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="20" y="40">Confirmed reading</text></svg>'});
        else if(path==='/api/pilot/action') {
          const body=route.request().postDataJSON();
          try {const out=await runAction(state,cashier,body.route,body.input);state=out.state;result=out.result;}
          catch(e){status=e.status||400;result={ok:false,error:e.message};}
        } else {status=404;result={ok:false};}
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
      });
      await page.goto('http://127.0.0.1:4347/pilot/cashier');
      await page.getByRole('heading',{name:'Choose a shift',exact:true}).waitFor();
      const opening=page.locator('.cashier-opening-card'),shift=page.locator('.cashier-shift-card').nth(1);
      assert.match(await opening.innerText(),/2026-10-02/);
      assert.equal(await shift.isEnabled(),!missing);
      if(!missing) {
        await shift.click();await page.getByRole('heading',{name:'End-of-Shift Cash Count',exact:true}).waitFor();
        await page.getByLabel('End-of-shift cash count ₱200 quantity',{exact:true}).fill('1');
        await page.getByRole('button',{name:'Confirm physical cash',exact:true}).click();
        await page.getByText(/Physical cash confirmed/).waitFor();
        await page.getByRole('button',{name:'Open Pump Register',exact:true}).click();
        try {await page.getByText('8 / 8 nozzles complete',{exact:true}).waitFor({timeout:5000});}
        catch(error){console.log(JSON.stringify({text:await page.locator('body').innerText(),pumps:state.reports[key].pumpRows}));throw error;}
        assert.deepEqual(state.reports[key].pumpRows,expectedPumps);
        assert.equal(await page.getByRole('button',{name:'Yes, confirm reading',exact:true}).count(),0);
      } else assert.match(await shift.innerText(),/Complete opening setup first/);
      assert.deepEqual(errors,[]);await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
