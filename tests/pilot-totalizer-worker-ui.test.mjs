import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('fallback worker preserves readings and camera responsiveness, then recovers from a failed worker',async()=>{
 const server=await createServer({cacheDir:'node_modules/.vite-reader-worker-test',server:{host:'127.0.0.1',port:0}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/ocr/neural/README.md`);
  let fail=true;
  await page.route('**/src/totalizer-reader.worker.js*',async route=>{
   if(fail){fail=false;return route.fulfill({contentType:'text/javascript',body:'throw Error("Fixture worker load failed");'});}
   await route.continue();
  });
  const result=await page.evaluate(async()=>{
   const {gridFixture}=await import('/tests/totalizer-grid-fixture.mjs');
   const {readTotalizerGridAsync}=await import('/src/totalizer-reader-client.js');
   const {readTotalizerGrid}=await import('/src/totalizer-grid.js');
   const args=gridFixture(),bytes=args[0].byteLength;let failed=false;
   try{await readTotalizerGridAsync(...args);}catch{failed=true;}
   const expected=readTotalizerGrid(...args);
   // Repeated candidate dots make this a substantial real geometry search.
   // The screen timer must keep running while both queued jobs complete.
   const dots=args[4].filter(c=>c.width===8&&c.height===8);
   const heavy=[...args.slice(0,4),args[4].concat(...Array(8).fill(dots))];
   let ticks=0;const timer=setInterval(()=>ticks++,10);
   try{
    const [actual,again]=await Promise.all([readTotalizerGridAsync(...heavy),readTotalizerGridAsync(...args)]);
    return {failed,ticks,bytes,after:args[0].byteLength,expected,actual,again};
   }finally{clearInterval(timer);}
  });
  assert.equal(result.failed,true);assert.equal(result.after,result.bytes);
  assert.deepEqual(result.again,result.expected);
  assert.equal(result.actual[0].value,234567.89);
  assert.ok(result.ticks>=2,'The camera screen must stay responsive during fallback searches');
 }finally{await browser.close();await server.close();}
});
