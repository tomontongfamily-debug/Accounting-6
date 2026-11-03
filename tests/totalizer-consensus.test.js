import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseTotalizerReading} from '../src/totalizer-consensus.js';
import {decodeTotalizerTokens} from '../src/totalizer-neural.js';
const nn=(value,extra={})=>({value,score:.99,integerConfidence:.99,fractionConfidence:.99,inputHeight:48,...extra});
const grid=(value,extra={})=>[{value,score:.005,margin:.14,...extra}];

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
});

test('A dominant reading across resolutions can resolve a fractional disagreement without altering agreed integer cells',()=>{
 const neural=[32,48,64].map(inputHeight=>nn(123456.1,{inputHeight}));neural.push(nn(123456.7));
 assert.equal(chooseTotalizerReading({neural,grid:grid(123456.7),tesseract:123456.3}),123456.1);
 assert.equal(chooseTotalizerReading({neural:[nn(123456.1)],grid:grid(123456.7),tesseract:123456.3}),null);
});
