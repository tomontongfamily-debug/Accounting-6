import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';
import {pumpCameraBootstrap,capturePumpCamera} from './pilot-camera-fixture.mjs';

for(const failure of ['upload-before-commit','lost-photo-response','lost-reading-response','invalid-photo-response'])test(`${failure}: kept phone capture retries the same request and reaches a desktop that began without photos`,async()=>{
 const server=await createServer({cacheDir:'node_modules/.vite/interrupted-photo-test',server:{host:'127.0.0.1',port:0,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let {state,key,cashier}=fixture();const report=state.reports[key];report.cashCountConfirmed=true;report.actualCashCounted=200;report.cashDenominations={200:1};report.pilotRevision=1;report.pilotLastNonReadingRevision=1;report.pilotCashRevision=1;
 const uploads=new Map(),receipts=new Map(),requests=[],errors=[];let failing=true;
 const phase=failure==='lost-reading-response'?'/api/demo/pump-reading':'/api/demo/photo';
 try{
  const pages=[];
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'Asia/Manila'});pages.push(page);
   await page.addInitScript(pumpCameraBootstrap);
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:`export async function prepareTotalizer(){};globalThis.recognitionCalls=0;export async function detectTotalizerResult(){globalThis.recognitionCalls++;return{reading:10010,attempt:{status:'detected',version:'interrupted-fixture',durationMs:1234}};}`}));
   await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let result,status=200;
    if(url.pathname==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:state.startDate};
    else if(url.pathname.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
    else if(url.pathname==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(url.searchParams.get('id'))});
    else if(url.pathname==='/api/pilot/action'){
     const body=route.request().postDataJSON(),fail=failing&&body.route===phase;
     if(body.route===phase&&!body.input.row?.readingConfirmed)requests.push(body);
     try{
      if(receipts.has(body.mutationId))result=receipts.get(body.mutationId);
      else{
       const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(_path,image)=>{
        if(uploads.has(body.mutationId))assert.deepEqual(uploads.get(body.mutationId),image);else uploads.set(body.mutationId,image);
       }});
       if(!(fail&&failure==='upload-before-commit')){state=out.state;result=out.result;if(body.route===phase)receipts.set(body.mutationId,result);}
      }
      if(fail&&failure==='invalid-photo-response')return route.fulfill({status:503,contentType:'text/html',body:'<html>Temporarily unavailable</html>'});
      if(fail){status=503;result={ok:false,error:'The save could not be verified. Retry with the same request.'};}
     }catch(e){status=e.status||400;result={ok:false,error:e.message};}
    }else result={ok:true,enabled:false};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pilot/cashier`);
  }
  const [desktop,phone]=pages;
  await desktop.getByRole('heading',{name:'Choose a shift',exact:true}).waitFor();await desktop.locator('.cashier-shift-card').first().click();
  await desktop.getByRole('button',{name:'Open Pump Register',exact:true}).click();
  const desktopCard=desktop.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
  assert.equal(await desktopCard.locator('.totalizer-photo').count(),0);
  await phone.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();await phone.getByLabel('Shift to photograph').selectOption(key);
  const card=phone.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);await capturePumpCamera(phone,card);
  const retry=card.getByRole('button',{name:failure==='lost-reading-response'?'Retry saving reading':'Retry saving photo',exact:true});
  await expect(retry).toBeVisible();assert.ok((await card.locator('.totalizer-photo').getAttribute('src')).startsWith('data:image/jpeg'));
  await expect(phone.getByLabel('Shift to photograph')).toBeDisabled();
  failing=false;await retry.click();await expect(card.getByRole('button',{name:'Yes, confirm reading',exact:true})).toBeEnabled();
  assert.equal(uploads.size,1);assert.equal(new Set(requests.map(r=>JSON.stringify(r))).size,1,'Every retry has the exact original request ID, revision and payload');
  assert.equal(await phone.evaluate(()=>globalThis.recognitionCalls),1);
  await desktop.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(desktopCard.locator('.totalizer-photo')).toHaveAttribute('src',state.reports[key].pumpRows[0].photo_path);
  await expect.poll(()=>desktopCard.locator('.totalizer-photo').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  await card.getByRole('button',{name:'Yes, confirm reading',exact:true}).click();await expect(card.getByText('✓ Complete',{exact:true})).toBeVisible();
  await desktop.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(desktopCard.getByText(/Reading confirmed and saved/)).toBeVisible();
  assert.equal(state.reports[key].pumpRows[0].closing,10010);assert.equal(state.reports[key].actualCashCounted,200);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
