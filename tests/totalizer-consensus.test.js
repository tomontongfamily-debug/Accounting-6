import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseTotalizerReading,chooseFastTotalizerReading,chooseRescueTotalizerReading,gridMatchesPhysicalRow,gridExplainsOcrHints} from '../src/totalizer-consensus.js';
import {decodeTotalizerTokens} from '../src/totalizer-neural.js';
const nn=(value,extra={})=>({value,score:.99,integerConfidence:.99,fractionConfidence:.99,inputHeight:48,...extra});
const grid=(value,extra={})=>[{value,score:.005,margin:.14,digitMargins:Array(8).fill(.14),...extra}];

test('unscaled neural digits need the exact independently proven short format',()=>{
 const neural=[48,64].map(inputHeight=>nn(null,{unscaledDigits:'988120',digitConfidences:Array(6).fill(.99),inputHeight}));
 assert.equal(chooseRescueTotalizerReading({primary:9881.2,neural}),null,'A neural digit string alone has no decimal');
 assert.equal(chooseRescueTotalizerReading({primary:9881.2,neural,digitCount:6}),9881.2);
 assert.equal(chooseRescueTotalizerReading({primary:9881.2,neural,digitCount:7}),null,'No hidden leading zero may be inserted');
 assert.equal(chooseRescueTotalizerReading({primary:988.12,neural,digitCount:6}),null,'A different decimal position cannot be substituted');
 assert.equal(chooseRescueTotalizerReading({primary:9881.2,neural:[...neural,nn(null,{unscaledDigits:'988127',digitConfidences:Array(6).fill(.99),inputHeight:32})],digitCount:6}),null);
});

test('a single qualified format pass needs three especially strong neural resolutions',()=>{
 const primary=27167.61,digitCount=7;
 const neural=[32,48,64].map(inputHeight=>nn(null,{score:.999,integerConfidence:.999,fractionConfidence:.999,
   unscaledDigits:'2716761',digitConfidences:Array(7).fill(.999),inputHeight}));
 const strict={primary,digitCount,minimumViews:3,minimumScore:.99,minimumInteger:.98,minimumFraction:.98};
 assert.equal(chooseRescueTotalizerReading({...strict,neural}),primary);
 assert.equal(chooseRescueTotalizerReading({...strict,neural:neural.slice(1)}),null);
 assert.equal(chooseRescueTotalizerReading({...strict,neural:[...neural.slice(0,2),{...neural[2],fractionConfidence:.979}]}),null);
 assert.equal(chooseRescueTotalizerReading({...strict,neural:[...neural,{...neural[0],unscaledDigits:'2716767'}]}),null);
});

test('a complete physical grid can explain OCR aliases but cannot discard a real or outside ninth cell',()=>{
 const candidate=grid(123456.78,{layout:{left:350,pitch:60,height:100,glyphWidth:40,base:150,slope:0,dotx:395}})[0];
 const cells=[...'12345678'].map((text,i)=>({text,confidence:99,bbox:{x0:50+i*60,x1:90+i*60,y0:50,y1:150}}));
 const symbols=structuredClone(cells);symbols.splice(2,0,{text:'1',bbox:{x0:185,x1:195,y0:52,y1:148}});
 const layouts=[{physical:{symbols:cells},hints:[{symbols}]}];
 assert.equal(gridMatchesPhysicalRow(candidate,cells),true);
 assert.equal(gridExplainsOcrHints(candidate,layouts),true);
 const extra=structuredClone(layouts);extra[0].physical.symbols.push(structuredClone(cells.at(-1)));
 assert.equal(gridExplainsOcrHints(candidate,extra),false);
 const outside=structuredClone(layouts);outside[0].hints[0].symbols[0].bbox={x0:0,x1:30,y0:50,y1:150};
 assert.equal(gridExplainsOcrHints(candidate,outside),false);
 const otherRow=structuredClone(layouts);otherRow[0].physical.symbols.forEach(s=>{s.bbox.y0+=200;s.bbox.y1+=200;});
 assert.equal(gridExplainsOcrHints(candidate,otherRow),false);
 assert.equal(gridExplainsOcrHints({...candidate,score:.05},layouts),false);
 assert.equal(gridExplainsOcrHints({...candidate,digitMargins:[.01,...Array(7).fill(.14)]},layouts),false);
});

test('resolution rescue requires two confident neural resolutions and no conflicting reading',()=>{
 const primary=876712.21,neural=[32,48,64].map(inputHeight=>nn(primary,{inputHeight}));
 assert.equal(chooseRescueTotalizerReading({primary,neural}),primary);
 assert.equal(chooseRescueTotalizerReading({primary:876712.27,neural}),null,'Reflection-induced primary seven must not override the visible one');
 for(const candidates of [[],[nn(primary)],[nn(primary),nn(primary)],
  [nn(primary),nn(primary,{inputHeight:32,integerConfidence:.89})],
  [nn(primary),nn(primary,{inputHeight:32,fractionConfidence:.94})],
  [...neural,nn(876712.27,{score:.3})]]){
  assert.equal(chooseRescueTotalizerReading({primary,neural:candidates}),null);
 }
 assert.equal(chooseRescueTotalizerReading({neural}),null);
});

test('neural short counters need an explicit two-place decimal and retain per-digit confidence',()=>{
 const characters=['blank',...'0123456789.,'];
 const decode=text=>{
  const data=new Float32Array(text.length*2*characters.length);
  for(let i=0;i<text.length;i++){data[i*2*characters.length+characters.indexOf(text[i])]=.99;data[(i*2+1)*characters.length]=1;}
  return decodeTotalizerTokens(data,[1,text.length*2,characters.length],characters);
 };
 for(const text of ['9881.20','12924.82','25065.00','12924,82']){
  const result=decode(text);
  assert.equal(result.value,Number(text.replace(',','.')));
  assert.equal(result.digitConfidences.length,text.length-1);
  assert.ok(result.integerConfidence>.98&&result.fractionConfidence>.98);
 }
 for(const text of ['988120','1292482','988.120','98812.0','9881..20','1234567.89'])assert.equal(decode(text).value,null,text);
});

test('the fast path needs independent agreement in every nonempty view and preserves full-grid outcomes',()=>{
 const value=123456.78,neural=[32,48,64].map(inputHeight=>nn(value,{inputHeight}));
 assert.equal(chooseFastTotalizerReading({tesseract:value,neural}),value);
 for(const physical of [[],grid(value),grid(723456.78),grid(123456.79),grid(value,{score:.2})]){
  assert.equal(chooseTotalizerReading({tesseract:value,neural,grid:physical}),value);
 }
 assert.equal(chooseFastTotalizerReading({neural}),null);
 assert.equal(chooseFastTotalizerReading({tesseract:value,neural:[]}),null);
 assert.equal(chooseFastTotalizerReading({tesseract:value,neural:[nn(null)]}),null);
 for(const conflict of [nn(723456.78),nn(123456.79),nn(723456.78,{score:.4})]){
  assert.equal(chooseFastTotalizerReading({tesseract:value,neural:[...neural,conflict]}),null);
 }
 for(const uncertain of [{score:.89},{integerConfidence:.84},{fractionConfidence:.49}]){
  assert.equal(chooseFastTotalizerReading({tesseract:value,neural:[nn(value,uncertain)]}),null);
 }
});

test('A high neural average cannot hide an uncertain integer digit',()=>{
 const characters=['blank',...'0123456789.'],text='12345678',steps=text.length*2,classes=characters.length,data=new Float32Array(steps*classes);
 for(let i=0;i<text.length;i++){data[(i*2)*classes+characters.indexOf(text[i])]=i===2?.55:.99;data[(i*2+1)*classes]=1;}
 const r=decodeTotalizerTokens(data,[1,steps,classes],characters);
 assert.equal(r.value,123456.78);assert.ok(r.score>.9);assert.ok(r.integerConfidence<.56);assert.equal(r.digitConfidences.length,8);
 assert.equal(chooseTotalizerReading({neural:[r],grid:grid(r.value)}),null);
});

test('A frame recognized as a ninth digit is rejected rather than truncated',()=>{
 const characters=['blank',...'0123456789.'],text='123456781',data=new Float32Array(text.length*2*characters.length);
 for(let i=0;i<text.length;i++){data[i*2*characters.length+characters.indexOf(text[i])]=1;data[(i*2+1)*characters.length]=1;}
 assert.equal(decodeTotalizerTokens(data,[1,text.length*2,characters.length],characters).value,null);
});

test('Repeated neural crops are not independent votes and cannot select a number alone',()=>{
 const neural=[32,48,64].map(inputHeight=>nn(123456.78,{inputHeight}));
 assert.equal(chooseTotalizerReading({neural}),null);
 assert.equal(chooseTotalizerReading({neural,tesseract:123456.78}),123456.78);
 assert.equal(chooseTotalizerReading({neural,grid:grid(123456.78)}),123456.78);
});

test('Conflicting supported integer readings require another view',()=>{
 assert.equal(chooseTotalizerReading({neural:[nn(123456.78),nn(723456.78)],grid:grid(723456.78),tesseract:123456.78}),null);
});

test('An independently fitted cell can corroborate a low-confidence narrow one but cannot rescue an uncertain two',()=>{
 const digitConfidences=[.99,.99,.99,.99,.99,.67,.99,.99];
 assert.equal(chooseTotalizerReading({neural:[nn(234561.23,{integerConfidence:.67,digitConfidences})],grid:grid(234561.23)}),234561.23);
 assert.equal(chooseTotalizerReading({neural:[nn(234562.23,{integerConfidence:.67,digitConfidences})],grid:grid(234562.23)}),null);
 assert.equal(chooseTotalizerReading({neural:[nn(234561.23,{integerConfidence:.67,digitConfidences})],grid:grid(234561.23,{digitMargins:Array(8).fill(.02)})}),null);
});

test('A dominant reading across resolutions can resolve a fractional disagreement without altering agreed integer cells',()=>{
 const neural=[32,48,64].map(inputHeight=>nn(123456.1,{inputHeight}));neural.push(nn(123456.7));
 assert.equal(chooseTotalizerReading({neural,grid:grid(123456.7),tesseract:123456.3}),123456.1);
 assert.equal(chooseTotalizerReading({neural:[nn(123456.1)],grid:grid(123456.7),tesseract:123456.3}),null);
});

test('A narrow one can use an independently recognized glyph in its physical cell, while a neighboring frame cannot corroborate it',()=>{
 const neural=[nn(234561.23,{integerConfidence:.67,digitConfidences:[.99,.99,.99,.99,.99,.67,.99,.99]})];
 const physical=grid(234561.23,{margin:.08,digitMargins:Array(8).fill(.08),layout:{left:100,pitch:50,glyphWidth:40,height:80,base:200,slope:0,dotx:160}});
 const glyph={text:'1',confidence:99,bbox:{x0:116,x1:124,y0:120,y1:200}};
 assert.equal(chooseTotalizerReading({neural,grid:physical,glyphs:[glyph]}),234561.23);
 assert.equal(chooseTotalizerReading({neural,grid:physical,glyphs:[{...glyph,bbox:{...glyph.bbox,x0:46,x1:54}}]}),null);
});
