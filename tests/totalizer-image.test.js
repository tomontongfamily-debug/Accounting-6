import test from 'node:test';
import assert from 'node:assert/strict';
import {readingWithVisibleDecimal,supportedTotalizerReading,provisionalShortTotalizerReading,corroboratedShortTotalizerSymbols,segmentDisplaySymbols,refineLeadingLcdDigit,refineNarrowLcdDigits,totalizerRegions,totalizerMask,totalizerCrop,withoutDisplayFrame,verifyLcdDigits} from '../src/totalizer-image.js';

const symbols=text=>[...text].map((text,i)=>({text,confidence:95,bbox:{x0:20+i*60,x1:60+i*60,y0:20,y1:120}}));
const dot=index=>({x:20+index*60-15,y:110,width:8,height:9,area:65});

test('a short neural rescue candidate retains complete physical cells and visible decimal',()=>{
 const detected=symbols('1292482'),physical=symbols('1292482');physical[2].text='?';
 assert.equal(provisionalShortTotalizerReading(detected,[dot(5)],physical),12924.82);
 assert.equal(provisionalShortTotalizerReading(detected,[],physical),null);
 assert.equal(provisionalShortTotalizerReading(detected,[dot(4),dot(5)],physical),null);
 assert.equal(provisionalShortTotalizerReading(detected,[dot(5)],physical.slice(1)),null);
 assert.equal(provisionalShortTotalizerReading(detected,[dot(5)],symbols('01292482')),null);
 const conflict=structuredClone(physical);conflict[1].text='3';
 assert.equal(provisionalShortTotalizerReading(detected,[dot(5)],conflict),null);
 for(const change of [{confidence:89},{lcdAmbiguous:true}]){
  const weak=structuredClone(detected);Object.assign(weak[0],change);
  assert.equal(provisionalShortTotalizerReading(weak,[dot(5)],physical),null);
 }
});

test('four- and five-integer displays require exact independent digits and a visible two-place decimal',()=>{
 for(const [text,integerDigits,value] of [['780855',4,7808.55],['1780855',5,17808.55],['007855',4,78.55]]){
  const detected=symbols(text),physical=symbols(text);
  assert.equal(supportedTotalizerReading(detected,[dot(integerDigits)],physical),value);
  assert.equal(supportedTotalizerReading(detected,[],physical),null,'No decimal can be inferred from the number of digits');
  assert.equal(supportedTotalizerReading(detected,[dot(integerDigits-1),dot(integerDigits)],physical),null,'Conflicting visible decimals require review');
  assert.equal(supportedTotalizerReading(detected,[dot(integerDigits)],physical.slice(1)),null,'Every visible digit needs independent cell evidence');
  const uncertain=structuredClone(physical);uncertain[0].text='?';
  assert.equal(supportedTotalizerReading(detected,[dot(integerDigits)],uncertain),null);
  const conflicting=structuredClone(physical);conflicting[1].text=String((Number(conflicting[1].text)+1)%10);
  assert.equal(supportedTotalizerReading(detected,[dot(integerDigits)],conflicting),null,'Disagreeing readers cannot supply a short totalizer');
  const lowConfidence=structuredClone(detected);lowConfidence[2].confidence=50;
  assert.equal(supportedTotalizerReading(lowConfidence,[dot(integerDigits)],physical),null);
 }
 const six=symbols('780855');
 assert.equal(supportedTotalizerReading(six,[dot(3)],six),null,'A three-place decimal cannot be rounded into two');
 assert.equal(supportedTotalizerReading(six,[dot(5)],six),null,'A one-place decimal cannot be padded into two');
 assert.equal(supportedTotalizerReading(six,[dot(4)],symbols('00780855')),null,'Do not infer hidden leading zero cells');
 assert.equal(supportedTotalizerReading(symbols('80855'),[dot(3)],symbols('780855')),null,'Do not drop a leading physical digit');
 assert.equal(supportedTotalizerReading(symbols('1780855'),[dot(5)],symbols('01780855')),null,'A cropped six-integer meter is not a five-integer meter');
});

test('seven integer digits require all nine independent cells and the visible two-place decimal',()=>{
 const nine=symbols('123456789');
 assert.equal(supportedTotalizerReading(nine,[dot(7)],structuredClone(nine)),1234567.89);
 assert.equal(supportedTotalizerReading(nine,[dot(7)],nine.slice(1)),null,'A frame must not supply an uncorroborated ninth digit');
 assert.equal(supportedTotalizerReading(nine,[dot(7)],symbols('723456789')),null);
 const unclear=structuredClone(nine);unclear[0].text='?';
 assert.equal(supportedTotalizerReading(nine,[dot(7)],unclear),null);
 assert.equal(supportedTotalizerReading(nine,[dot(6)],nine),null,'Never round a three-place decimal');
 assert.equal(supportedTotalizerReading(nine.slice(1),[dot(7)],nine),null,'Never drop a leading physical cell');
 assert.equal(supportedTotalizerReading(symbols('23456789'),[dot(6)],symbols('23456789')),234567.89);
});
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

function joinedShortDisplay(){
 const width=440,height=180,gray=new Uint8Array(width*height).fill(180),text='780855',lefts=[50,110,170,218,278,338];
 const boxes=[[8,0,28,14],[34,16,8,28],[34,66,8,28],[8,86,28,14],[1,66,8,28],[1,16,8,28],[8,43,28,14]];
 for(const [index,digit] of [...text].entries())for(const [segment,on] of [...patterns[Number(digit)]].entries())if(on==='1'){
  const [left,top,w,h]=boxes[segment];
  for(let y=top;y<top+h;y++)for(let x=left;x<left+w;x++){
   // These strokes are weaker than the mask threshold, but their measured
   // contrast still exceeds the independent grayscale stroke requirement.
   const faint=index===0&&segment===2&&y<78||index===3&&segment===1&&y>=24;
   gray[(30+y)*width+lefts[index]+x]-=faint?9:40;
  }
 }
 for(let y=121;y<129;y++)for(let x=264;x<272;x++)gray[y*width+x]-=40;
 const {mask,components}=totalizerRegions(gray,width,height);
 const region={x:48,y:30,width:335,height:101,bandHeight:96};
 return {gray,width,height,mask,components,region,text};
}

test('joined short-display cells and mixed contrast use independent physical boxes and every original-image digit',()=>{
 const image=joinedShortDisplay(),{gray,width,height,components,region,text}=image;
 const physical=segmentDisplaySymbols(image.mask,width,region);
 assert.equal(physical.length,6,'A narrow whitespace valley separates the neighboring zero/eight cells');
 assert.equal(physical[0].text,'?');assert.equal(physical[3].text,'?');
 const detected=physical.map((s,index)=>({...s,text:text[index],confidence:99}));
 // Model the overlapping OCR character boxes produced by joined strokes.
 detected[3].bbox={...detected[3].bbox,x0:detected[2].bbox.x0+10};
 detected[4].bbox={...detected[4].bbox,x0:detected[3].bbox.x0-2};
 assert.equal(readingWithVisibleDecimal(detected,components,{integerDigits:4,decimalPlaces:2}),null);
 assert.equal(supportedTotalizerReading(detected,components,physical),null,'Weak binary-mask digits alone cannot establish the result');
 const aligned=corroboratedShortTotalizerSymbols(detected,components,physical,{gray,width,height});
 assert.ok(aligned,'Every cell has a unique independently verified grayscale stroke pattern');
 assert.equal(supportedTotalizerReading(detected,components,physical,{gray,width,height}),7808.55);
 assert.deepEqual(aligned.map(s=>s.bbox),physical.map(s=>s.bbox),'Final verification retains independent cell geometry');
 assert.equal(verifyLcdDigits(aligned,gray,width,height,[],{requireEveryDigit:true}),true);
 assert.equal(supportedTotalizerReading(detected,[...components,{x:214,y:121,width:8,height:8,area:64}],physical,{gray,width,height}),null,'Conflicting decimal evidence cannot be resolved from OCR text');
 const wrong=structuredClone(detected);wrong[0].text='1';
 assert.equal(supportedTotalizerReading(wrong,components,physical,{gray,width,height}),null,'Original top-bar evidence rejects the conflicting leading digit');
 const missing=gray.slice(),middle=physical[2].bbox;
 for(let y=middle.y0-5;y<middle.y1+5;y++)for(let x=middle.x0-5;x<middle.x1+5;x++)missing[y*width+x]=180;
 assert.equal(supportedTotalizerReading(detected,components,physical,{gray:missing,width,height}),null,'An unreadable interior glyph cannot hide behind confidence in the other digits');
});

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

test('A visible top stroke recovers a seven while preserving genuine ones and recognized sevens',()=>{
  for(const digit of [1,7]){
    const {s,gray,width,height}=faintDigit(patterns[digit]);
    // Shift the complete physical digit into the third digit cell.
    const shifted=new Uint8Array(gray.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)shifted[y*width+x]=150+Math.round((x-120)*.05);
    for(let y=30;y<150;y++)for(let x=90;x<150;x++)shifted[y*width+x+120]=gray[y*width+x];
    s[2]={...s[2],text:'1',bbox:{...s[2].bbox,x0:252}};
    const refined=refineNarrowLcdDigits(s,shifted,width,height);
    assert.equal(refined[2].text,String(digit));
    assert.equal(s[2].text,'1','The original OCR symbols remain unchanged');
    s[2].text='7';assert.equal(refineNarrowLcdDigits(s,shifted,width,height)[2].text,'7');
  }
});

test('Missing or uncertain top-bar evidence cannot turn an OCR one into a seven',()=>{
  for(const [pattern,contrast]of [['0000000',18],['1110000',5],['1111000',18]]) {
    const {s,gray,width,height}=faintDigit(pattern,contrast);
    s[0].text='1';
    assert.equal(refineNarrowLcdDigits(s,gray,width,height)[0].text,'1');
  }
});

test('A top-bar speck seen at only one alignment flags the digit for review instead of accepting a one',()=>{
  const {s,gray,width,height}=faintDigit(patterns[1]);s[0].text='1';
  for(let x=108;x<132;x++)gray[40*width+x]-=60;
  const refined=refineNarrowLcdDigits(s,gray,width,height);
  assert.equal(refined[0].text,'1');assert.equal(refined[0].lcdAmbiguous,true);
  assert.equal(s[0].lcdAmbiguous,undefined);
});

test('A faint upper-left reflection cannot turn a strongly visible three into a nine',()=>{
  const {s,gray,width,height}=faintDigit(patterns[3],40);s[0].text='3';
  for(let y=56;y<87;y++)for(let x=101;x<108;x++)gray[y*width+x]-=8;
  const refined=refineLeadingLcdDigit(s,gray,width,height);
  assert.equal(refined[0].text,'3');
  assert.equal(refined[0].lcdVerified,undefined);
});

test('A faint top reflection cannot turn a strongly visible one into a seven',()=>{
  const {s,gray,width,height}=faintDigit(patterns[1],40);s[0].text='1';
  for(let y=43;y<50;y++)for(let x=108;x<132;x++)gray[y*width+x]-=8;
  const refined=refineNarrowLcdDigits(s,gray,width,height);
  assert.equal(refined[0].text,'1');
  assert.equal(refined[0].lcdVerified,undefined);
  assert.equal(refined[0].lcdAmbiguous,undefined);
});

test('The station format rejects extra integer and decimal cells instead of rounding a guess',()=>{
  const format={integerDigits:6,decimalPlaces:2};
  assert.equal(readingWithVisibleDecimal(symbols('12345678'),[dot(6)],format),123456.78);
  assert.equal(readingWithVisibleDecimal(symbols('123456781'),[dot(6)],format),null);
  assert.equal(readingWithVisibleDecimal(symbols('123456780'),[dot(6)],format),null,'A trailing zero cannot hide a third decimal cell');
  assert.equal(readingWithVisibleDecimal(symbols('112345678'),[dot(7)],format),null);
});

test('Continuous frame strokes are removed without changing disconnected LCD strokes or the original image',()=>{
  const width=150,height=120,mask=new Uint8Array(width*height),region={x:0,y:10,width,height:100,bandHeight:86};
  for(let y=10;y<110;y++)for(let x=140;x<145;x++)mask[y*width+x]=1;
  for(const [top,bottom]of [[18,48],[68,99]])for(let y=top;y<bottom;y++)for(let x=65;x<72;x++)mask[y*width+x]=1;
  const clean=withoutDisplayFrame(mask,width,region);
  assert.equal(clean[60*width+142],0);assert.equal(mask[60*width+142],1);
  assert.equal(clean[30*width+68],1);assert.equal(clean[80*width+68],1);
});

test('A high-confidence OCR number without physical LCD evidence cannot pass corroboration',()=>{
  assert.equal(verifyLcdDigits(symbols('12345678'),new Uint8Array(600*180).fill(220),600,180),false);
});
