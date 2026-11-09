import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

const [manifest,output,baselineFile]=process.argv.slice(2);
if(!manifest||!output)throw Error('Usage: node scripts/benchmark-totalizer.mjs manifest.json results.json [baseline.json]');
const samples=JSON.parse(fs.readFileSync(manifest,'utf8'));
const server=await createServer({server:{host:'127.0.0.1',port:4389,strictPort:true,hmr:false}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:900}});
 const cpuRate=Number(process.env.TOTALIZER_CPU_THROTTLE||1);
 if(cpuRate>1){const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});}
 await page.goto('http://127.0.0.1:4389/ocr/neural/README.md');
 await page.evaluate(async()=>{await(await import('/src/totalizer-ocr.js')).prepareTotalizer();});
 for(const [index,sample] of samples.entries()){
  const input='data:image/jpeg;base64,'+fs.readFileSync(sample.file).toString('base64');
  const result=await page.evaluate(async input=>{
   const events=[];const reader=await import('/src/totalizer-ocr.js');
   const result=await reader.detectTotalizerResult(input,{onTrace:event=>events.push(event)});
   return {...result,events};
  },input);
  const row={index,file:sample.file,expected:sample.expected,...result};
  results.push(row);fs.writeFileSync(output,JSON.stringify(results,null,2));
  console.log(JSON.stringify({index,expected:sample.expected,reading:result.reading,status:result.attempt.status,reason:result.events.at(-1)?.reason,milliseconds:result.attempt.durationMs}));
 }
}finally{await browser.close();await server.close();}
console.log(JSON.stringify({samples:results.length,correct:results.filter(r=>r.reading!==null&&r.reading===r.expected).length,abstained:results.filter(r=>r.reading===null).length,wrong:results.filter(r=>r.reading!==null&&r.reading!==r.expected).length}));
for(const row of results){
 assert.ok(row.reading===null||row.reading===row.expected,`Incorrect automatic reading at sample ${row.index}`);
 assert.notEqual(row.attempt.status,'error',`Reader error at sample ${row.index}`);
}
if(baselineFile){
 const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
 assert.equal(baseline.length,results.length,'Compare the exact same corpus');
 for(const [i,row]of baseline.entries()){
  assert.equal(row.file,results[i].file);assert.equal(row.expected,results[i].expected);
  if(row.reading!==null)assert.equal(results[i].reading,row.reading,`Lost an existing successful reading at sample ${i}`);
 }
 assert.ok(results.filter(r=>r.reading!==null).length>baseline.filter(r=>r.reading!==null).length,'Require measured recovery of rejected photos');
}
