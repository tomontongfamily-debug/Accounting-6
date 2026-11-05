import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('expired photo releases its preparation wait and never starts late inference',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   globalThis.readerOperations=[];
   globalThis.Worker=class{
    postMessage({id,operation}){globalThis.readerOperations.push(operation);queueMicrotask(()=>this.onmessage({data:{id,result:operation==='neural'?[]:true}}));}
    terminate(){}
   };
  });
  await page.route('**/src/ocr-downloads.js*',route=>route.fulfill({contentType:'text/javascript',body:'let promise;export function prepareReaderFiles(){return promise ||=new Promise(resolve=>globalThis.finishReaderDownload=resolve);}'}));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/ocr/neural/README.md`);
  const result=await page.evaluate(async()=>{
   const reader=await import('/src/totalizer-reader-client.js');
   const pixels=new Uint8ClampedArray(4),pending=reader.neuralTotalizerCandidatesAsync(pixels,1,1,[]).then(()=>false,()=>true);
   reader.cancelAdvancedTotalizer();
   const canceled=await pending;
   globalThis.finishReaderDownload({});await reader.prepareAdvancedTotalizer();
   const before=[...globalThis.readerOperations];
   await reader.neuralTotalizerCandidatesAsync(pixels,1,1,[]);
   return {canceled,before,after:globalThis.readerOperations,bytes:pixels.byteLength};
  });
  assert.equal(result.canceled,true);assert.deepEqual(result.before,['prepare']);assert.deepEqual(result.after,['prepare','neural']);assert.equal(result.bytes,4);
  await page.reload();
  const unsupported=await page.evaluate(async()=>{
   WebAssembly.validate=()=>false;
   const reader=await import('/src/totalizer-reader-client.js');
   try{await reader.prepareAdvancedTotalizer();return false;}catch(error){return error.reason;}
  });
  assert.equal(unsupported,'unsupported-browser');
  assert.equal(await page.evaluate(()=>typeof globalThis.finishReaderDownload),'undefined','Unsupported phones must not begin the large reader download');
 }finally{await browser.close();await server.close();}
});
