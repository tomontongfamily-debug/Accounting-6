import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTotalizerGlyph} from '../src/totalizer-glyph-model.js';
import {physicalTotalizerCandidate} from '../src/totalizer-image.js';

test('photo-derived glyph evidence can resolve weak strokes without accepting absent strokes',()=>{
 for(const [digit,coverage]of [
  ['7',[1,1,.52,0,0,0,0]],['4',[0,1,.4,0,0,1,1]],
  ['0',[.96,1,.48,1,1,.48,0]],['2',[.4,.8,0,.96,.8,0,.76]],
  ['6',[1,0,1,1,.96,.44,1]],
 ])assert.equal(classifyTotalizerGlyph(coverage),digit);
 for(const coverage of [[],Array(7).fill(0),Array(7).fill(.5),[1,1,NaN,0,0,0,0],[1,1,2,0,0,0,0]])assert.equal(classifyTotalizerGlyph(coverage),null);
});

test('a physical corroborator requires a complete count, visible decimal and enough direct stroke patterns',()=>{
 const cells=[...'12345678'].map((text,i)=>({text,direct:true,confidence:99,bbox:{x0:20+i*60,x1:60+i*60,y0:20,y1:120}}));
 const dot={x:365,y:110,width:8,height:9,area:65};
 assert.equal(physicalTotalizerCandidate(cells,[dot]),123456.78);
 assert.equal(physicalTotalizerCandidate(cells,[]),null);
 assert.equal(physicalTotalizerCandidate([...cells,cells.at(-1)],[dot]),null,'A physical ninth digit cannot be discarded');
 const weak=structuredClone(cells);weak[2].text='?';assert.equal(physicalTotalizerCandidate(weak,[dot]),null);
 const inferred=structuredClone(cells);for(let i=0;i<5;i++)inferred[i].direct=false;
 assert.equal(physicalTotalizerCandidate(inferred,[dot]),null,'A classifier alone cannot supply the whole counter');
});
