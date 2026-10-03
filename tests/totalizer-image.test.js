import test from 'node:test';
import assert from 'node:assert/strict';
import {readingWithVisibleDecimal,totalizerRegions,totalizerCrop} from '../src/totalizer-image.js';

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
