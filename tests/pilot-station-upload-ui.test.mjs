import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '@playwright/test';
import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

// Opt-in private photos remain outside Git. This checks actual file selection,
// JPEG compression, OCR auto-fill and persistence using fixture reports only.
test('All station photos auto-fill through the phone upload flow',{skip:!process.env.TOTALIZER_STATION_MANIFEST},async()=>{
 const samples=JSON.parse(fs.readFileSync(process.env.TOTALIZER_STATION_MANIFEST,'utf8'));
 const server=await preview({preview:{host:'127.0.0.1',port:4341,strictPort:true}});
 const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
 try{
  for(const [i,sample]of samples.entries()){
   const context=await browser.newContext({viewport:{width:390,height:900},timezoneId:'Asia/Manila'});
   try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    let {state,key,report,cashier}=fixture();const uploads=new Map(),writes=[];
    await page.route('**/api/**',async route=>{
     const url=new URL(route.request().url());let result,status=200;
     if(url.pathname==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(url.searchParams.get('id'))});
     if(url.pathname==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
     else if(url.pathname.startsWith('/api/auth/'))result={ok:true,role:'Cashier',token:'cookie',branch:'Liloan',expiresAt:Date.now()+3600000};
     else if(url.pathname==='/api/pilot/action'){
      const body=route.request().postDataJSON();
      if(['/api/demo/photo','/api/demo/pump-reading'].includes(body.route))writes.push(body.route);
      try{const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(path,image)=>uploads.set(body.mutationId,image)});state=out.state;result=out.result;}
      catch(e){status=e.status||400;result={ok:false,error:e.message};}
     }else{status=404;result={ok:false};}
     await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto('http://127.0.0.1:4341/pilot/cashier');
    await page.getByLabel('Six-digit branch PIN').fill('000000');await page.getByRole('button',{name:'Proceed',exact:true}).click();
    await page.getByRole('heading',{name:'Pump photos',exact:true}).waitFor();
    await page.getByLabel('Shift to photograph').selectOption(key);
    const card=page.locator(`[data-pump-row-id="${report.pumpRows[0].id}"]`);
    await card.locator('input[type=file]').setInputFiles(sample.file);
    await card.getByText('Saving photo or reading…',{exact:true}).waitFor({state:'hidden',timeout:30000});
    const input=card.locator('input[inputmode=decimal]');await input.waitFor();
    const reading=(await input.inputValue())===''?null:Number(await input.inputValue());
    results.push({sample:i+1,file:sample.file,reading,expected:sample.expected});
    assert.equal(reading,sample.expected,`Phone upload photo ${i+1}`);
    if(reading!==null){
     assert.notEqual(await input.getAttribute('readonly'),null,'No manual input is needed');
     assert.equal(state.reports[key].pumpRows[0].ocr_detected_reading,reading);
    }
    assert.equal(state.reports[key].pumpRows[0].readingConfirmed,false);
    assert.deepEqual(writes,['/api/demo/photo','/api/demo/pump-reading'],'Photo and OCR suggestion need only two server saves');
    assert.equal(state.reports[key].confirmed,false);assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
  console.log('Phone upload OCR validation:',JSON.stringify(results));
  if(process.env.TOTALIZER_UPLOAD_RESULTS)fs.writeFileSync(process.env.TOTALIZER_UPLOAD_RESULTS,JSON.stringify(results,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
});
