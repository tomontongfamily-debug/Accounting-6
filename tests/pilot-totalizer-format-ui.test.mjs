import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {totalizerDisplayFixture} from './totalizer-display-fixture.mjs';

test('the real reader verifies seven integer digits without neural downloads and retains decimal/frame guards',async()=>{
 const server=await createServer({cacheDir:'node_modules/.vite/totalizer-format-test',server:{host:'127.0.0.1',port:0,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),requests=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/ocr/neural/README.md`);
  const read=async options=>{
   const data=await page.evaluate(totalizerDisplayFixture,options);
   return page.evaluate(async data=>{const reader=await import('/src/totalizer-ocr.js');return reader.detectTotalizerResult(data);},data);
  };
  const blank=await read({text:''});assert.equal(blank.reading,null);
  assert.equal(requests.some(path=>path.includes('/core/')||path.endsWith('.onnx')||path.includes('/ort/')),false,'Missing digit rows need no model or runtime download');
  const longer=await read({text:'1234567.89'});
  assert.equal(longer.reading,1234567.89);assert.equal(longer.attempt.status,'detected');
  assert.equal(longer.attempt.version,'lcd-fast-consensus-5');assert.ok(longer.attempt.durationMs>=0);
  assert.equal(requests.some(path=>path.endsWith('.onnx')||path.includes('/ort/')),false,'The nine-cell path must not download a fallback that fits only eight cells');
  const regular=await read({text:'234567.89'});assert.equal(regular.reading,234567.89);
  const framed=await read({text:'234567.89',frame:true});assert.ok(framed.reading===null||framed.reading===234567.89,'A frame cannot become an extra leading digit');
  const extra=await read({text:'1234567.890'});assert.equal(extra.reading,null,'A third decimal cell cannot be rounded or dropped');
  console.log('Local synthetic real-engine timings (not device benchmarks):',JSON.stringify({sevenDigitsMs:longer.attempt.durationMs,sixDigitsMs:regular.attempt.durationMs}));
 }finally{await browser.close();await server.close();}
});
