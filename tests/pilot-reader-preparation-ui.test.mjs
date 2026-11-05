import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fixture} from './pilot-fixture.mjs';
import {runAction} from '../pilot/service.mjs';

for(const {automatic,cache}of [{automatic:false,cache:true},{automatic:true,cache:true},{automatic:false,cache:false}])test(`reader files prepare ${automatic?'automatically on a fast connection':'optionally on a slow connection'} ${cache?'and survive refresh':'without persistent storage or duplicate downloads'}`,async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:44344,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let{state,cashier}=fixture();const writes=[],downloads=[];
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},timezoneId:'Asia/Manila'});
  if(!cache)await page.addInitScript(()=>Object.defineProperty(globalThis,'caches',{configurable:true,value:undefined}));
  await page.addInitScript(automatic=>Object.defineProperty(navigator,'connection',{configurable:true,value:{effectiveType:automatic?'4g':'3g',downlink:automatic?10:1.5,saveData:false}}),automatic);
  page.on('request',request=>{if(/\/(neural|ort)\//.test(new URL(request.url()).pathname))downloads.push(request.url());});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result;
   if(path==='/api/pilot/config')result={ok:true,mode:'shadow',start_date:'2026-09-23'};
   else if(path.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    const out=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId});
    if(out.changed)writes.push(body.route);state=out.state;result=out.result;
   }else result={ok:true,enabled:false};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:44344/pilot/cashier');
  const panel=page.getByRole('complementary',{name:'Automatic reader preparation'});
  if(!automatic){
   await expect(panel.getByRole('button',{name:'Prepare faster readings'})).toBeEnabled();
   assert.equal(downloads.length,0,'Slow connections must not silently start the larger download');
   await panel.getByRole('button',{name:'Prepare faster readings'}).click();
  }
  await expect(panel).toContainText(cache?'Reader ready for faster photos.':'Reader ready for this page.',{timeout:10000});
  assert.equal(downloads.length,3);assert.deepEqual(writes,[]);
  await expect(page.getByRole('button',{name:'Open camera',exact:true}).first()).toBeEnabled();
  if(!cache){
   assert.deepEqual(await page.evaluate(async()=>{
    const {prepareAdvancedTotalizer,neuralTotalizerCandidatesAsync}=await import('/src/totalizer-reader-client.js');
    await prepareAdvancedTotalizer();
    return neuralTotalizerCandidatesAsync(new Uint8ClampedArray(4),1,1,[]);
   }),[]);
   assert.equal(downloads.length,3,'The worker must reuse the verified bytes when persistent storage is unavailable');
   return;
  }
  await panel.screenshot({path:'../../outputs/Pump-reader-ready.png'});
  await page.reload();
  await expect(page.getByRole('complementary',{name:'Automatic reader preparation'})).toContainText('Reader ready for faster photos.');
  assert.equal(downloads.length,3,'Refresh must reuse the explicit file cache');assert.deepEqual(writes,[]);
 }finally{await browser.close();await server.close();}
});

test('a download longer than runtime initialization timeout works and survives blocked network after refresh',{timeout:60000},async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:44345,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();let blocked=false,requests=0;
  await page.route('**/ocr/lcd-neural-3-20261104/**',async route=>{
   requests++;if(blocked)return route.abort();
   if(route.request().url().endsWith('.wasm'))await new Promise(resolve=>setTimeout(resolve,21000));
   await route.continue();
  });
  await page.goto('http://127.0.0.1:44345/ocr/neural/README.md');
  const start=Date.now();
  const prepare=()=>page.evaluate(async()=>{
   const{prepareNeuralTotalizer}=await import('/src/totalizer-neural.js');
   const{session,characters}=await prepareNeuralTotalizer();return{inputs:session.inputNames.length,characters:characters.length};
  });
  assert.deepEqual(await prepare(),{inputs:1,characters:438});assert.ok(Date.now()-start>=21000);
  const initialRequests=requests;assert.equal(initialRequests,3);blocked=true;
  await page.reload();assert.deepEqual(await prepare(),{inputs:1,characters:438});
  assert.equal(requests,initialRequests,'A new page must use the verified files without any network request');
 }finally{await browser.close();await server.close();}
});
