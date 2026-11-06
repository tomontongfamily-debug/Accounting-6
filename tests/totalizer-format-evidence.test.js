import test from 'node:test';
import assert from 'node:assert/strict';
import {canDismissNineCellHint} from '../src/totalizer-format-evidence.js';
import {totalizerRegions,withoutDisplayFrame,segmentDisplaySymbols,readingWithVisibleDecimal} from '../src/totalizer-image.js';

const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
function fixture(text='15117097',offset=0,wideOnes=false){
  const width=650+offset,height=180,gray=new Uint8Array(width*height).fill(190),top=30,left=65+offset,pitch=65;
  const strokes=[[8,0,28,10],[34,8,8,36],[34,56,8,38],[8,90,28,10],[1,56,8,38],[1,8,8,36],[8,45,28,10]];
  for(const [index,digit]of [...text].entries())for(const [segment,on]of [...patterns[Number(digit)]].entries())if(on==='1'){
    const [x0,y0,w,h]=wideOnes&&digit==='1'?(segment===1?[33,8,12,36]:[29,56,12,38]):strokes[segment];
    for(let y=top+y0;y<top+y0+h;y++)for(let x=left+index*pitch+x0;x<left+index*pitch+x0+w;x++)gray[y*width+x]=105;
  }
  const decimal={x:left+(text.length-3)*pitch+49,y:top+91,width:8,height:8};
  for(let y=decimal.y;y<decimal.y+decimal.height;y++)for(let x=decimal.x;x<decimal.x+decimal.width;x++)gray[y*width+x]=105;
  const region={x:left-2,y:top-2,width:(text.length-1)*pitch+46,height:104,bandHeight:100};
  const analysis=totalizerRegions(gray,width,height);
  const symbols=segmentDisplaySymbols(withoutDisplayFrame(analysis.mask,width,region),width,region);
  assert.equal(symbols.map(symbol=>symbol.text).join(''),text,'Fixture must have actual independent physical cells');
  assert.equal(readingWithVisibleDecimal(symbols,analysis.components,{integerDigits:text.length-2,decimalPlaces:2}),Number(text.slice(0,-2)+'.'+text.slice(-2)));
  const scope={regionId:'number-row',layoutId:'primary'};
  const physical={...scope,region,symbols,components:analysis.components,image:{gray,width,height}};
  const agreeingPasses=[{...scope,symbols:structuredClone(symbols),confidence:96}];
  const hint={...scope,symbols:structuredClone(symbols)};
  return {physical,agreeingPasses,hint,decimal};
}
function splitAt(proof,index=2){
  const symbols=proof.hint.symbols,physical=proof.physical.symbols[index],box=physical.bbox;
  const fullWidth=41,left=physical.text==='1'?box.x1-fullWidth:box.x0;
  const ghost={text:physical.text==='7'?'1':'7',confidence:95,bbox:{x0:left+2,x1:box.x1-1,y0:box.y0+2,y1:box.y1-2}};
  symbols.splice(index,0,ghost);
  return proof;
}

test('only a proven interior split dismisses an OCR hint across different values and positions',()=>{
  for(const [text,offset,index]of [['15117097',0,2],['92683075',13,4],['12063876',29,5]]){
    const proof=splitAt(fixture(text,offset),index);
    assert.equal(canDismissNineCellHint(proof),true,text);
    assert.equal(proof.hint.symbols.length,9,'The helper does not mutate OCR evidence');
    assert.equal(proof.physical.symbols.map(symbol=>symbol.text).join(''),text);
  }
});

function paddedProof(text='15117097',offset=0){
  const proof=splitAt(fixture(text,offset,true));
  for(const {bbox}of proof.hint.symbols){bbox.x0--;bbox.x1++;bbox.y0-=2;bbox.y1+=2;}
  if(text.startsWith('1')){
    const first=proof.physical.symbols[0].bbox,box=proof.hint.symbols[0].bbox;
    // An OCR line box can include adjacent blank space around a narrow one,
    // while its center still lies on that same physical first digit.
    box.x0=first.x0-2;box.x1=first.x1+14;box.y0=first.y0-1;
    box.y1=Math.max(...proof.physical.symbols.map(symbol=>symbol.bbox.y1))+6;
  }
  return proof;
}
test('bounded OCR box borders retain exact physical center ranges across different meters',()=>{
  for(const [text,offset]of [['15117097',0],['12063876',23],['92683075',31]]){
    assert.equal(canDismissNineCellHint(paddedProof(text,offset)),true,text);
  }
});
test('padding cannot absorb outside centers, oversized glyphs, or extra first/final cells',()=>{
  const changes=[
    proof=>{const first=proof.physical.symbols[0].bbox;Object.assign(proof.hint.symbols[0].bbox,{x0:first.x0-2,x1:first.x0+1});},
    proof=>{const top=Math.min(...proof.physical.symbols.map(symbol=>symbol.bbox.y0));Object.assign(proof.hint.symbols[2].bbox,{y0:top-7,y1:top-1});},
    proof=>{const box=proof.hint.symbols[2].bbox,center=(box.x0+box.x1)/2;box.x0=center-40;box.x1=center+40;},
    proof=>{proof.hint.symbols[0].bbox.x0=proof.physical.symbols[0].bbox.x0-4;},
    proof=>{proof.hint.symbols.at(-1).bbox.y1=Math.max(...proof.physical.symbols.map(symbol=>symbol.bbox.y1))+9;},
  ];
  for(const change of changes){const proof=paddedProof();change(proof);assert.equal(canDismissNineCellHint(proof),false);}
  for(const index of [0,7]){
    const proof=fixture('15117097',0,true),box=proof.physical.symbols[index].bbox;
    const duplicate={text:proof.physical.symbols[index].text,confidence:99,bbox:{x0:box.x0+1,x1:box.x1-1,y0:box.y0+1,y1:box.y1-1}};
    proof.hint.symbols.splice(index,0,duplicate);
    let code;assert.equal(canDismissNineCellHint(proof,{onDecision:event=>{code=event.code;}}),false);
    assert.equal(code,14,'Even a contained outer duplicate must retain the nine-cell guard');
  }
});
test('a wide merged physical one cannot hide two glyphs inside an inferred normal-width cell',()=>{
  const proof=fixture(),{gray,width}=proof.physical.image,index=2,left=65+index*65,top=30;
  for(let y=top;y<top+100;y++)for(let x=left;x<left+65;x++)gray[y*width+x]=190;
  for(const [x0,y0,w,h]of [[54,8,10,36],[54,56,10,38],[1,8,63,2]]){
    for(let y=top+y0;y<top+y0+h;y++)for(let x=left+x0;x<left+x0+w;x++)gray[y*width+x]=105;
  }
  const analysis=totalizerRegions(gray,width,proof.physical.image.height);
  proof.physical.symbols=segmentDisplaySymbols(withoutDisplayFrame(analysis.mask,width,proof.physical.region),width,proof.physical.region);
  assert.equal(proof.physical.symbols.map(symbol=>symbol.text).join(''),'15117097','The widened binary cell can still uniquely resemble one');
  assert.ok(proof.physical.symbols[index].bbox.x1-proof.physical.symbols[index].bbox.x0>41*1.35);
  proof.agreeingPasses[0].symbols=structuredClone(proof.physical.symbols);
  proof.hint.symbols=structuredClone(proof.physical.symbols);
  proof.hint.symbols[index].bbox={x0:left+54,x1:left+64,y0:top+8,y1:top+94};
  splitAt(proof,index);
  let code;assert.equal(canDismissNineCellHint(proof,{onDecision:event=>{code=event.code;}}),false);
  assert.equal(code,10,'Independent physical cell width must reject the merge before OCR-center assignment');
});
test('a real extra leading glyph remains guarded, including before a narrow first one',()=>{
  for(const extra of ['1','8']){
    const proof=fixture(),first=proof.physical.symbols[0].bbox;
    proof.hint.symbols.unshift({text:extra,confidence:99,bbox:{x0:first.x0-35,x1:first.x0-10,y0:first.y0,y1:first.y1}});
    assert.equal(canDismissNineCellHint(proof),false);
  }
  const proof=splitAt(fixture());proof.hint.symbols[0].bbox.x0-=4;
  assert.equal(canDismissNineCellHint(proof),false,'Box spill is capped; it cannot add an inferred leading cell');
});
test('physical nine-cell and unknown-cell evidence cannot be dismissed',()=>{
  const nine=fixture('115117097');
  assert.equal(canDismissNineCellHint(nine),false);
  nine.physical.symbols[0].text='?';assert.equal(canDismissNineCellHint(nine),false);
  const unclear=splitAt(fixture());unclear.physical.symbols[3].text='?';
  assert.equal(canDismissNineCellHint(unclear),false);
});
test('a matching confidence-qualified eight-cell OCR pass is required in the same layout',()=>{
  for(const change of [
    proof=>{proof.agreeingPasses=[];},
    proof=>{proof.agreeingPasses[0].confidence=69;},
    proof=>{proof.agreeingPasses[0].symbols[4].confidence=89;},
    proof=>{proof.agreeingPasses[0].symbols[3].lcdAmbiguous=true;},
    proof=>{proof.agreeingPasses[0].symbols[3].text='8';},
    proof=>{proof.agreeingPasses[0].layoutId='other-crop';},
    proof=>{proof.hint.regionId='different-row';},
  ]){const proof=splitAt(fixture());change(proof);assert.equal(canDismissNineCellHint(proof),false);}
});
test('missing, conflicting, and misplaced physical decimal marks retain the guard',()=>{
  for(const mode of ['missing','conflicting','three-places']){
    const proof=splitAt(fixture()),{gray,width}=proof.physical.image,{decimal}=proof;
    if(mode!=='conflicting')for(let y=decimal.y;y<decimal.y+8;y++)for(let x=decimal.x;x<decimal.x+8;x++)gray[y*width+x]=190;
    if(mode!=='missing'){
      const x0=decimal.x-65;for(let y=decimal.y;y<decimal.y+8;y++)for(let x=x0;x<x0+8;x++)gray[y*width+x]=105;
    }
    assert.equal(canDismissNineCellHint(proof),false,mode);
  }
});
test('raw image evidence must agree with the supplied physical cells',()=>{
  const blank=splitAt(fixture());blank.physical.image.gray.fill(190);
  assert.equal(canDismissNineCellHint(blank),false,'Claimed binary symbols cannot rescue a blank grayscale image');
  const stale=splitAt(fixture());stale.physical.symbols[4].bbox.x0++;
  assert.equal(canDismissNineCellHint(stale),false,'The exact independent boxes must come from this image');
  const conflict=splitAt(fixture());conflict.physical.symbols[4].text='1';
  assert.equal(canDismissNineCellHint(conflict),false,'A supplied digit cannot override the raw image');
});
test('the nine OCR glyphs must cover all cells in order with exactly one interior duplicate',()=>{
  const changes=[
    proof=>{proof.hint.symbols[3].bbox.x0=proof.physical.symbols[1].bbox.x0;},
    proof=>{proof.hint.symbols[4].bbox={...proof.hint.symbols[3].bbox};},
    proof=>{[proof.hint.symbols[4],proof.hint.symbols[5]]=[proof.hint.symbols[5],proof.hint.symbols[4]];},
    proof=>{proof.hint.symbols[3].text='8';},
    proof=>{proof.hint.symbols[0].text='8';},
    proof=>{proof.hint.symbols[2].bbox.y0=1;},
  ];
  for(const change of changes){const proof=splitAt(fixture());change(proof);assert.equal(canDismissNineCellHint(proof),false);}
  for(const edge of [0,7])assert.equal(canDismissNineCellHint(splitAt(fixture(),edge)),false,'An outer split must remain guarded');
});
test('malformed or missing proof fails closed without throwing',()=>{
  for(const value of [undefined,{},null,{physical:{symbols:[]}}]){
    assert.equal(canDismissNineCellHint(value),false);
  }
  for(const change of [
    proof=>{delete proof.physical.image;},
    proof=>{proof.physical.region.x=-1;},
    proof=>{proof.hint.symbols[2].bbox.x1=NaN;},
    proof=>{delete proof.physical.layoutId;delete proof.hint.layoutId;},
  ]){const proof=splitAt(fixture());change(proof);assert.equal(canDismissNineCellHint(proof),false);}
});

test('optional diagnostic decisions report numeric gates without changing acceptance',()=>{
  const accepted=splitAt(fixture()),events=[];
  assert.equal(canDismissNineCellHint(accepted,{onDecision:event=>events.push(event)}),true);
  assert.deepEqual(events,[{code:0,reason:'proven-split'}]);
  const outside=splitAt(fixture());outside.hint.symbols[0].bbox.x0-=4;
  const rejected=[];
  assert.equal(canDismissNineCellHint(outside,{onDecision:event=>rejected.push(event)}),false);
  assert.equal(rejected.length,1);assert.equal(rejected[0].code,12);assert.equal(rejected[0].reason,'envelope');
  assert.equal(rejected[0].index,0);assert.ok(rejected[0].bbox.x0<rejected[0].envelope.left);
  for(const proof of [accepted,outside]){
    const expected=canDismissNineCellHint(proof);
    assert.equal(canDismissNineCellHint(proof,{onDecision:()=>{throw Error('Observer failure');}}),expected);
  }
  const unqualified=splitAt(fixture());unqualified.agreeingPasses=[];
  let code;canDismissNineCellHint(unqualified,{onDecision:event=>{code=event.code;}});assert.equal(code,9);
});
