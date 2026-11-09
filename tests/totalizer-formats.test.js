import test from 'node:test';
import assert from 'node:assert/strict';
import {totalizerFormatForStation,confirmedTotalizerFormat,formatTotalizerSuggestion} from '../src/totalizer-formats.js';
import {provisionalShortTotalizerReading} from '../src/totalizer-image.js';
import {completedPhotoOcrEvidence,MABOLO_TOTALIZER_FORMAT_ID} from '../src/ocr-evidence.js';

test('only the owner-confirmed Mabolo format can supply missing decimal placement',()=>{
 const format=totalizerFormatForStation(' Mabolo ');
 assert.equal(format.integerDigits,5);assert.equal(format.decimalPlaces,2);assert.ok(Object.isFrozen(format));
 assert.equal(confirmedTotalizerFormat({...format}),format);
 assert.equal(formatTotalizerSuggestion(25065,format),'25065.00');
 assert.equal(formatTotalizerSuggestion(1.005,format),'1.005','Formatting must not hide extra precision');
 for(const station of ['Barili','Arpili','Liloan','Pondol','Moalboal',''])assert.equal(totalizerFormatForStation(station),null);
 assert.equal(confirmedTotalizerFormat({integerDigits:5,decimalPlaces:2}),null);
 assert.equal(confirmedTotalizerFormat({...format,integerDigits:6}),null);
 const digits=[...'2506500'].map((text,i)=>({text,confidence:99,bbox:{x0:20+i*60,x1:60+i*60,y0:20,y1:100}}));
 const physical=structuredClone(digits);physical[5].text='?';
 assert.equal(provisionalShortTotalizerReading(digits,[],physical),null);
 assert.equal(provisionalShortTotalizerReading(digits,[],physical,{format}),25065);
 assert.equal(provisionalShortTotalizerReading(digits.slice(1),[],physical.slice(1),{format}),null,'Missing digits cannot be inferred');
 assert.equal(provisionalShortTotalizerReading(digits,[],[...physical,physical[6]],{format}),null,'An extra cell cannot be dropped');
 const conflicting=structuredClone(physical);conflicting[0].text='3';
 assert.equal(provisionalShortTotalizerReading(digits,[],conflicting,{format}),null);
 const otherDecimal={x:243,y:92,width:8,height:8,area:64};
 assert.equal(provisionalShortTotalizerReading(digits,[otherDecimal],physical,{format}),null,'A visible three-place decimal contradicts the profile');
 const twoPlace={...otherDecimal,x:303};
 assert.equal(provisionalShortTotalizerReading(digits,[twoPlace,otherDecimal],physical,{format}),null,'Conflicting points require review');
});

test('saved OCR evidence identifies the configured format without accepting arbitrary metadata',()=>{
 const result={reading:25065,attempt:{status:'detected',version:'test',formatProfile:MABOLO_TOTALIZER_FORMAT_ID}};
 assert.equal(completedPhotoOcrEvidence('/photo',result).ocr_result.formatProfile,MABOLO_TOTALIZER_FORMAT_ID);
 result.attempt.formatProfile='unverified-format';
 assert.equal(completedPhotoOcrEvidence('/photo',result).ocr_result.formatProfile,undefined);
});
