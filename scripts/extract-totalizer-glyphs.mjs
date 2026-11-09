import fs from 'node:fs';import {createServer} from 'vite';import {chromium} from '@playwright/test';
const [manifest,output]=process.argv.slice(2);
if(!manifest||!output)throw Error('Usage: node scripts/extract-totalizer-glyphs.mjs private-manifest.json private-features.json');
const samples=JSON.parse(fs.readFileSync(manifest));const server=await createServer({server:{host:'127.0.0.1',port:4391,strictPort:true,hmr:false}});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});const rows=[];
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:4391/ocr/neural/README.md');
for(const [index,sample]of samples.entries()){
 const data='data:image/jpeg;base64,'+fs.readFileSync(sample.file).toString('base64');
 const result=await page.evaluate(async({data,expected,index})=>{
 const image=new Image();image.src=data;await image.decode();const scale=Math.min(1,1280/Math.max(image.width,image.height));const c=document.createElement('canvas');c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);
 const {analyzeTotalizerFrame}=await import('/src/totalizer-frame-client.js');const {segmentDisplaySymbols,withoutDisplayFrame,readingWithVisibleDecimal}=await import('/src/totalizer-image.js');const f=await analyzeTotalizerFrame(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);const text=String(Math.round(expected*100)).padStart(8,'0');
 if(text.length!==8)return [];
 for(const r of f.analysis.regions){
  const cells=segmentDisplaySymbols(withoutDisplayFrame(f.analysis.mask,c.width,r),c.width,r);
  if(cells.length!==8||cells.some((s,i)=>s.text!=='?'&&s.text!==text[i]))continue;
  const labelled=cells.map((s,i)=>({...s,text:text[i]}));
  if(readingWithVisibleDecimal(labelled,f.analysis.components,{integerDigits:6,decimalPlaces:2})!==expected)continue;
  return cells.map((s,i)=>({photo:index,label:Number(text[i]),known:s.text!=='?',features:s.coverage}));
 }
 return [];
 },{data,expected:sample.expected,index});rows.push(...result);if(index%50===0)console.log(JSON.stringify({photos:index,digits:rows.length}));
}
fs.writeFileSync(output,JSON.stringify(rows));console.log(JSON.stringify({photos:samples.length,digits:rows.length}));}
finally{await browser.close();await server.close();}
