import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

// Private station photos stay outside the repository. Supply a local JSON array
// of {file, expected} entries; expected:null means the image needs human review.
test('Real station photos are read in the browser without guessing ambiguous digits',{skip:!process.env.TOTALIZER_STATION_MANIFEST},async()=>{
 const samples=JSON.parse(fs.readFileSync(process.env.TOTALIZER_STATION_MANIFEST,'utf8'));
 const server=await createServer({cacheDir:'node_modules/.vite-station-ocr-test',server:{host:'127.0.0.1',port:4339,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900}});
  await page.goto('http://127.0.0.1:4339/');
  const results=[];
  for(const [i,sample]of samples.entries()){
   const data='data:image/jpeg;base64,'+fs.readFileSync(sample.file).toString('base64');
   const reading=await page.evaluate(async data=>{const{detectTotalizer}=await import('/src/totalizer-ocr.js');return detectTotalizer(data);},data);
   results.push({sample:i+1,expected:sample.expected,reading});
  }
  console.log('Station OCR validation:',JSON.stringify(results));
  for(const r of results)assert.equal(r.reading,r.expected,`Station photo ${r.sample}`);
 }finally{await browser.close();await server.close();}
});
