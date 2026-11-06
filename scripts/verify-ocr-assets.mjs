import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {OCR_ASSET_ROOT} from '../src/ocr-assets.js';
import {OCR_DOWNLOADS,PRIMARY_OCR_DOWNLOADS} from '../src/ocr-downloads.js';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url));
const sha=file=>crypto.createHash('sha256').update(read(file)).digest('hex');
assert.equal(sha('public/ocr/neural/english-mobile.onnx'),'c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8');
assert.equal(JSON.parse(read('public/ocr/neural/characters.json')).length,438);
assert.equal(JSON.parse(read('node_modules/onnxruntime-web/package.json')).version,'1.31.1');
assert.ok(read('public/ocr/neural/LICENSE').length>1000);assert.ok(read('public/ocr/neural/PADDLE-LICENSE').length>1000);
assert.ok(read('public/ocr/ort/LICENSE').length>1000);
assert.equal(sha('public/ocr/ort/ort-wasm-simd-threaded.wasm'),sha('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'));
for(const file of [...Object.values(OCR_DOWNLOADS),...Object.values(PRIMARY_OCR_DOWNLOADS)]){
 assert.equal(read('public/ocr/'+file.path).length,file.bytes);
 assert.equal(sha('public/ocr/'+file.path),file.sha256,'Reader cache integrity pin must match the shipped file');
 if(file.decoded){
  const decoded=gunzipSync(read('public/ocr/'+file.path));
  assert.equal(decoded.length,file.decoded.bytes);
  assert.equal(crypto.createHash('sha256').update(decoded).digest('hex'),file.decoded.sha256);
 }
}
const deployment=JSON.parse(read('vercel.json'));
assert.ok(deployment.rewrites.some(rule=>rule.source===OCR_ASSET_ROOT+'/:path*'&&rule.destination==='/ocr/:path*'),'Versioned OCR files need their production static rewrite');
assert.ok(deployment.headers.some(rule=>rule.source===OCR_ASSET_ROOT+'/:path*'&&rule.headers.some(header=>header.key==='Cache-Control'&&header.value.includes('immutable'))),'Versioned OCR files must remain cacheable');
console.log('OCR model, vocabulary, runtime and license checks passed.');
