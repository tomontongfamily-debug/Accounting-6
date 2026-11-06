import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateNineCellHints} from '../src/totalizer-ocr.js';
import {canDismissNineCellHint} from '../src/totalizer-format-evidence.js';
import {totalizerRegions,withoutDisplayFrame,segmentDisplaySymbols} from '../src/totalizer-image.js';

// Draw independent physical strokes, then supply a separate OCR pass that
// splits one interior cell. No private photo or expected production reading is
// passed into the recognition pipeline by these state-combination tests.
function layout(){
 const width=650,height=180,gray=new Uint8Array(width*height).fill(190),text='15117097';
 const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
 const strokes=[[8,0,28,10],[34,8,8,36],[34,56,8,38],[8,90,28,10],[1,56,8,38],[1,8,8,36],[8,45,28,10]];
 for(const [index,digit]of [...text].entries())for(const [segment,on]of [...patterns[Number(digit)]].entries())if(on==='1'){
  const [dx,dy,w,h]=strokes[segment];for(let y=30+dy;y<30+dy+h;y++)for(let x=65+index*65+dx;x<65+index*65+dx+w;x++)gray[y*width+x]=105;
 }
 for(let y=121;y<129;y++)for(let x=439;x<447;x++)gray[y*width+x]=105;
 const region={x:63,y:28,width:501,height:104,bandHeight:100},analysis=totalizerRegions(gray,width,height);
 const symbols=segmentDisplaySymbols(withoutDisplayFrame(analysis.mask,width,region),width,region);
 assert.equal(symbols.map(symbol=>symbol.text).join(''),text);
 const scope={regionId:0,layoutId:0},physical={...scope,region,symbols,components:analysis.components,image:{gray,width,height}};
 const hint={...scope,symbols:structuredClone(symbols)},box=symbols[2].bbox;
 hint.symbols.splice(2,0,{text:'7',confidence:95,bbox:{x0:box.x1-39,x1:box.x1-1,y0:box.y0+2,y1:box.y1-2}});
 return {physical,hints:[hint],agreeingPasses:[{...scope,symbols:structuredClone(symbols),confidence:96}]};
}
test('deferred hint remains guarded until a qualified pass from its own layout proves the split',()=>{
 const evidence=layout(),[qualified]=evidence.agreeingPasses;
 assert.equal(canDismissNineCellHint({physical:evidence.physical,hint:evidence.hints[0],agreeingPasses:evidence.agreeingPasses}),true);
 evidence.agreeingPasses=[];
 assert.equal(evaluateNineCellHints([evidence]).blocked,true);
 evidence.agreeingPasses.push(qualified);
 const evaluated=evaluateNineCellHints([evidence]);
 assert.equal(evaluated.blocked,false);assert.deepEqual(evaluated.layouts[0].dismissed,[true]);
 assert.equal(evidence.hints[0].symbols.length,9,'Dismissal does not rewrite or remove OCR evidence');
});
test('one explained hint cannot cancel another unexplained hint, even with matching digits',()=>{
 const explained=layout(),unexplained=layout();unexplained.hints[0].layoutId=1;
 const evaluated=evaluateNineCellHints([explained,unexplained]);
 assert.equal(evaluated.blocked,true);assert.deepEqual(evaluated.layouts.map(value=>value.dismissed),[[true],[false]]);
 const sameLayout=layout();sameLayout.hints.push({...structuredClone(sameLayout.hints[0]),regionId:1});
 assert.equal(evaluateNineCellHints([sameLayout]).blocked,true);
});
test('physical nine cells block the fallback regardless of other explained hints or OCR hint count',()=>{
 const explained=layout(),nine=layout();nine.physical.symbols.push(structuredClone(nine.physical.symbols.at(-1)));nine.hints=[];
 const evaluated=evaluateNineCellHints([explained,nine]);
 assert.equal(evaluated.blocked,true);assert.equal(evaluated.layouts[1].physicalCount,9);
});
test('eight-cell rows without OCR nine-cell hints keep the existing fallback available',()=>{
 const evidence=layout();evidence.hints=[];evidence.agreeingPasses=[];
 assert.equal(evaluateNineCellHints([evidence]).blocked,false);assert.equal(evaluateNineCellHints([]).blocked,false);
});
test('optional aggregate diagnostics explain exact rejected bounds without changing the guard decision',()=>{
 const proof=layout();
 const accepted=evaluateNineCellHints([proof],{trace:true});
 assert.equal(accepted.blocked,false);assert.equal(accepted.layouts[0].decisions[0].code,0);
 proof.hints[0].symbols[0].bbox.x0--;
 const rejected=evaluateNineCellHints([proof],{trace:true});
 assert.equal(rejected.blocked,true);assert.equal(rejected.layouts[0].decisions[0].code,12);
 assert.equal(rejected.layouts[0].decisions[0].index,0);assert.ok(rejected.layouts[0].decisions[0].bbox);
 assert.ok(rejected.layouts[0].decisions[0].envelope);
 const ordinary=evaluateNineCellHints([proof]);assert.equal(ordinary.blocked,true);
 assert.equal(ordinary.layouts[0].decisions,undefined,'Ordinary recognition does not collect diagnostic payloads');
});
