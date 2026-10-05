import test from 'node:test';
import assert from 'node:assert/strict';
import {readingWithVisibleDecimal,refineLeadingLcdDigit,refineNarrowLcdDigits,totalizerRegions,totalizerMask,totalizerCrop} from '../src/totalizer-image.js';

const symbols=text=>[...text].map((text,i)=>({text,confidence:95,bbox:{x0:20+i*60,x1:60+i*60,y0:20,y1:120}}));
const dot=index=>({x:20+index*60-15,y:110,width:8,height:9,area:65});
test('The physical decimal distinguishes readings independently of the opening value',()=>{
  assert.equal(readingWithVisibleDecimal(symbols('12345678'),[dot(6)]),123456.78);
  assert.equal(readingWithVisibleDecimal(symbols('875421'),[dot(3)]),875.421);
  assert.equal(readingWithVisibleDecimal(symbols('0001234'),[dot(5)]),12.34);
});
test('Missing, ambiguous or reflection-shaped decimal marks cannot produce a guessed reading',()=>{
  const s=symbols('12345678');
  assert.equal(readingWithVisibleDecimal(s,[]),null);
  assert.equal(readingWithVisibleDecimal(s,[dot(5),dot(6)]),null);
  assert.equal(readingWithVisibleDecimal(s,[{...dot(6),area:10}]),null);
  assert.equal(readingWithVisibleDecimal(s,[{...dot(6),y:40}]),null);
});
test('A broken stroke in an earlier integer digit cannot hide the real decimal',()=>{
  assert.equal(readingWithVisibleDecimal(symbols('12345678'),[dot(1),dot(6)]),123456.78);
});
test('Broken strokes inside a decimal digit and tiny speckles do not count as decimal points',()=>{
  assert.equal(readingWithVisibleDecimal(symbols('12345678'),[
    dot(6),{x:342,y:110,width:8,height:9,area:65},{x:378,y:115,width:5,height:4,area:14},
  ]),123456.78);
});
test('An overlapping frame recognized as an extra leading digit is rejected',()=>{
  const s=symbols('12345678');s[0].bbox.x1=120;
  assert.equal(readingWithVisibleDecimal(s,[dot(6)]),null);
});
test('Uncertain digits and separate label rows are rejected',()=>{
  const s=symbols('12345678');s[2].confidence=50;
  assert.equal(readingWithVisibleDecimal(s,[dot(6)]),null);
  s[2].confidence=95;s[2].bbox.y1=60;
  assert.equal(readingWithVisibleDecimal(s,[dot(6)]),null);
  assert.equal(readingWithVisibleDecimal([...symbols('12345678')].reverse(),[dot(6)]),null);
});
test('Blank and uniformly bright images do not create totalizer regions',()=>{
  for(const brightness of [0,128,255]){
    const result=totalizerRegions(new Uint8Array(100*100).fill(brightness),100,100);
    assert.deepEqual(result.regions,[]);assert.equal(result.mask.some(Boolean),false);
  }
});
test('Local contrast retains dark digits under a broad lighting gradient',()=>{
  const w=400,h=160,gray=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)gray[y*w+x]=150+Math.round(x/5);
  for(let n=0;n<6;n++)for(let y=40;y<120;y++)for(let x=30+n*50;x<40+n*50;x++)gray[y*w+x]-=80;
  const result=totalizerRegions(gray,w,h);assert.ok(result.regions.length>0);
  assert.equal(result.mask[80*w+35],1);assert.equal(result.mask[80*w+50],0);
  const crop=totalizerCrop(result.mask,w,h,result.regions[0]);
  assert.equal(crop.rgba[0],255);assert.ok(crop.rgba.some(v=>v===0));
});

const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
function faintDigit(pattern,contrast=18){
  const width=520,height=210,gray=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)gray[y*width+x]=150+Math.round(x*.05);
  const boxes=[[108,43,24,7],[132,56,7,31],[132,106,7,31],[108,131,24,7],[101,106,7,31],[101,56,7,31],[108,87,24,7]];
  for(const [i,on]of [...pattern].entries())if(on==='1'){
    const [x0,y0,w,h]=boxes[i];for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)gray[y*width+x]-=contrast;
  }
  const s=[...'888888'].map((text,i)=>({text,confidence:99,bbox:{x0:100+i*60,x1:140+i*60,y0:40,y1:140}}));
  return {s,gray,width,height};
}
test('Seven physical strokes independently distinguish all ten faint leading digits',()=>{
  for(const [digit,pattern]of patterns.entries()){
    const {s,gray,width,height}=faintDigit(pattern);s[0].text=String((digit+1)%10);
    const refined=refineLeadingLcdDigit(s,gray,width,height);
    assert.equal(refined[0].text,String(digit),`Physical digit ${digit}`);
    assert.equal(refined[0].lcdVerified,true);
    assert.equal(s[0].text,String((digit+1)%10),'The original OCR result is not mutated');
  }
});
test('Blank, incomplete and uncertain stroke patterns cannot override OCR',()=>{
  for(const [pattern,contrast]of [['0000000',18],['0010011',18],['0110011',5]]){
    const {s,gray,width,height}=faintDigit(pattern,contrast);
    assert.equal(refineLeadingLcdDigit(s,gray,width,height),s);
  }
});
test('The sensitive mask retains faint strokes without changing image coordinates',()=>{
  const {gray,width,height}=faintDigit(patterns[4],10);
  const normal=totalizerMask(gray,width,height),sensitive=totalizerMask(gray,width,height,5);
  assert.equal(sensitive.length,normal.length);
  assert.ok(sensitive.reduce((n,v)=>n+v,0)>normal.reduce((n,v)=>n+v,0));
});

test('A visible top stroke distinguishes a trailing seven from an OCR one without changing genuine ones',()=>{
  for(const digit of [1,7]){
    const {s,gray,width,height}=faintDigit(patterns[digit]);
    // Shift the complete physical digit into the third digit cell.
    const shifted=new Uint8Array(gray.length).fill(180);
    for(let y=30;y<150;y++)for(let x=90;x<150;x++)shifted[y*width+x+120]=gray[y*width+x];
    s[2]={...s[2],text:'1',bbox:{...s[2].bbox,x0:252}};
    const refined=refineNarrowLcdDigits(s,shifted,width,height);
    assert.equal(refined[2].text,String(digit));
    assert.equal(s[2].text,'1','The original OCR symbols remain unchanged');
  }
});
