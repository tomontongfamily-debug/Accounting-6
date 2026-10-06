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
   const values=await page.evaluate(async({data,variants})=>{
    const{detectTotalizer}=await import('/src/totalizer-ocr.js');
    const read=async(image,label)=>{const start=performance.now();const reading=await detectTotalizer(image);return {label,reading,milliseconds:Math.round(performance.now()-start)};};
    const out=[await read(data,'original')];
    if(variants) {
      const image=new Image();image.src=data;await image.decode();
      for(const [size,quality]of [[1800,.92],[1800,.9],[1280,.92],[1000,.85]]) {
        const scale=Math.min(1,size/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
        canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        out.push(await read(canvas.toDataURL('image/jpeg',quality),`${size}px JPEG ${quality}`));
      }
    }
    return out;
   },{data,variants:process.env.TOTALIZER_UPLOAD_VARIANTS==='1'});
   results.push(...values.map(value=>({sample:i+1,expected:sample.expected,...value})));
  }
  console.log('Station OCR validation:',JSON.stringify(results));
  if(process.env.TOTALIZER_BENCHMARK_RESULTS)fs.writeFileSync(process.env.TOTALIZER_BENCHMARK_RESULTS,JSON.stringify(results,null,2));
  for(const r of results)assert.equal(r.reading,r.expected,`Station photo ${r.sample}`);
 }finally{await browser.close();await server.close();}
});
