import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {OCR_ASSET_ROOT} from '../src/ocr-assets.js';

test('opening the reader loads the small engine and retains a working on-demand fallback',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:44341,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage(),requests=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.goto('http://127.0.0.1:44341/ocr/neural/README.md');
  requests.length=0;
  await page.evaluate(async()=>{const reader=await import('/src/totalizer-ocr.js');await reader.prepareTotalizer();});
  assert.ok(requests.some(path=>path.startsWith(OCR_ASSET_ROOT+'/core/')));
  assert.ok(requests.some(path=>path===OCR_ASSET_ROOT+'/lang/ssd_int.traineddata.gz'));
  assert.equal(requests.some(path=>path.endsWith('.onnx')||path.includes('/ort/')),false);
  const fallback=await page.evaluate(async()=>{
   const {prepareNeuralTotalizer}=await import('/src/totalizer-neural.js');
   const {session,characters}=await prepareNeuralTotalizer();
   return{inputs:session.inputNames.length,characters:characters.length};
  });
  assert.ok(fallback.inputs>0);assert.equal(fallback.characters,438);
  assert.ok(requests.includes(OCR_ASSET_ROOT+'/neural/english-mobile.onnx'));
  assert.ok(requests.includes(OCR_ASSET_ROOT+'/ort/ort-wasm-simd-threaded.wasm'));
 }finally{await browser.close();await server.close();}
});
