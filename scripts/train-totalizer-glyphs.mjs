import fs from 'node:fs';
import assert from 'node:assert/strict';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/train-totalizer-glyphs.mjs private-features.json weights.js');
const data=JSON.parse(fs.readFileSync(input));
for(const r of data)assert.ok(Number.isInteger(r.photo)&&r.photo>=0&&Number.isInteger(r.label)&&r.label>=0&&r.label<=9&&r.features?.length===7&&r.features.every(v=>Number.isFinite(v)&&v>=0&&v<=1),'Invalid training features');
const train=data.filter(r=>r.photo<500),holdout=data.filter(r=>r.photo>=500),weights=Array.from({length:10},()=>new Float64Array(8));
const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
for(let c=0;c<10;c++)for(let j=0;j<7;j++)weights[c][j]=Number(patterns[c][j])?1:-1;
const freq=Array(10).fill(0);train.forEach(r=>freq[r.label]++);
assert.ok(freq.every(n=>n>=20)&&holdout.length>0,'Require all ten digits and a separate validation group');
const classWeight=freq.map(n=>train.length/(10*n));
for(let epoch=0;epoch<1600;epoch++){
 const gradient=Array.from({length:10},()=>new Float64Array(8));let total=0;
 for(const row of train){const x=[...row.features.map(v=>(v-.5)*2),1],scores=weights.map(w=>w.reduce((s,a,j)=>s+a*x[j],0)),max=Math.max(...scores),exp=scores.map(s=>Math.exp(s-max)),sum=exp.reduce((a,b)=>a+b,0),factor=classWeight[row.label]*(row.known?1:3);total+=factor;
  for(let c=0;c<10;c++){const e=(exp[c]/sum-(row.label===c?1:0))*factor;for(let j=0;j<8;j++)gradient[c][j]+=e*x[j];}
 }
 for(let c=0;c<10;c++)for(let j=0;j<8;j++)weights[c][j]-=.65*(gradient[c][j]/total+(j<7?.0002*weights[c][j]:0));
}
function predict(row){const x=[...row.features.map(v=>(v-.5)*2),1],scores=weights.map((w,digit)=>({digit,score:w.reduce((s,a,j)=>s+a*x[j],0)})).sort((a,b)=>b.score-a.score);const sum=scores.reduce((s,x)=>s+Math.exp(x.score-scores[0].score),0);return {label:row.label,predicted:scores[0].digit,p:1/sum,margin:scores[0].score-scores[1].score,known:row.known,photo:row.photo};}
const results=holdout.map(predict);
for(const threshold of [.8,.9,.95,.98,.99,.995,.999]){const kept=results.filter(r=>r.p>=threshold);console.log(JSON.stringify({threshold,total:holdout.length,accepted:kept.length,wrong:kept.filter(r=>r.predicted!==r.label).length,unknown:kept.filter(r=>!r.known).length,unknownWrong:kept.filter(r=>!r.known&&r.predicted!==r.label).length}));}
fs.writeFileSync(output,'// Fitted seven-stroke coefficients; no photos or counter values are shipped.\nexport const TOTALIZER_GLYPH_WEIGHTS='+JSON.stringify(weights.map(w=>[...w].map(v=>Math.round(v*1e7)/1e7)))+';\n');console.log(JSON.stringify({trainDigits:train.length,trainPhotos:new Set(train.map(r=>r.photo)).size,holdoutDigits:holdout.length,holdoutPhotos:new Set(holdout.map(r=>r.photo)).size}));
