import test from 'node:test';
import assert from 'node:assert/strict';
import {supportsNeuralTotalizer,assertNeuralTotalizerSupport} from '../src/ocr-capabilities.js';

test('the advanced reader probes the required SIMD instructions before preparing model files',()=>{
 let bytes;
 assert.equal(supportsNeuralTotalizer({validate:module=>{bytes=module;return WebAssembly.validate(module);}}),true);
 assert.deepEqual([...bytes.slice(0,8)],[0,97,115,109,1,0,0,0]);
 assert.ok([...bytes].some((value,index)=>value===253&&bytes[index+1]===186&&bytes[index+2]===1),'Probe must include i32x4.dot_i16x8_s');
 assert.equal(supportsNeuralTotalizer({validate:()=>false}),false);
 assert.equal(supportsNeuralTotalizer({validate:()=>{throw Error('Disabled WebAssembly');}}),false);
 assert.equal(supportsNeuralTotalizer({}),false);assert.equal(supportsNeuralTotalizer(null),false);
 assert.doesNotThrow(()=>assertNeuralTotalizerSupport());
});
