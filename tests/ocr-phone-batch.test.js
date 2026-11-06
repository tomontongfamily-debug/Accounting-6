import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parsePhoneBatch,safePhoneBatch,redactDiagnosticText,calibrationMetrics,CALIBRATION_BYTES} from '../src/ocr-phone-batch.js';

const signed='https://chqinknijqtixeenhtvu.supabase.co/storage/v1/object/sign/fueltech-pilot-photos/station/photo.jpg?token=private-example';
const fragment=value=>'#batch='+encodeURIComponent(JSON.stringify(value));
const valid=()=>({waitFor:'enhanced',startDelayMs:15000,networkLabel:'Android ingress 64 KiB/s',expectedIngressBytesPerSecond:65536,sources:[{name:'Pump 4 original',difficulty:'easy',expected:7808.55,url:signed}]});
test('fragment batch validates approved signed sources and exports no source URLs or tokens',()=>{
 const config=parsePhoneBatch(fragment(valid()));
 assert.equal(config.startDelayMs,15000);assert.equal(config.sources[0].expected,7808.55);
 const exported=JSON.stringify(safePhoneBatch(config));
 assert.ok(!exported.includes('https://'));assert.ok(!exported.includes('private-example'));assert.ok(!exported.includes('url'));
 assert.equal(parsePhoneBatch(''),null);
});
for(const [name,change]of [
 ['lookalike host',value=>value.sources[0].url=signed.replace('.supabase.co/','.supabase.co.evil.test/')],
 ['other bucket',value=>value.sources[0].url=signed.replace('fueltech-pilot-photos','public')],
 ['public unsigned photo',value=>value.sources[0].url=signed.replace('/object/sign/','/object/public/')],
 ['credentials',value=>value.sources[0].url=signed.replace('https://','https://user:password@')],
 ['missing token',value=>value.sources[0].url=signed.split('?')[0]],
 ['traversal',value=>value.sources[0].url=signed.replace('station/photo.jpg','%2e%2e/other.jpg')],
 ['too many sources',value=>value.sources=Array.from({length:5},()=>value.sources[0])],
 ['invalid expected',value=>value.sources[0].expected='7808.555'],
 ['invalid difficulty',value=>value.sources[0].difficulty='guaranteed'],
 ['excessive delay',value=>value.startDelayMs=60001],
 ['invalid rate',value=>value.expectedIngressBytesPerSecond=0],
 ['nonboolean trace switch',value=>value.trace='execute-script'],
 ['unknown stress transform',value=>value.sources[0].stress='arbitrary-script'],
 ['invalid expected outcome',value=>value.sources[0].expectedOutcome='timeout-is-success'],
 ['stress numeric success expectation',value=>{value.sources[0].stress='extreme-glare';value.sources[0].expectedOutcome='detected';}],
])test(`fragment batch rejects ${name} without echoing a signed link`,()=>{
 const value=valid();change(value);
 assert.throws(()=>parsePhoneBatch(fragment(value)),error=>error.message==='Invalid automatic photo-batch configuration.');
});
test('malformed or oversized fragments fail safely',()=>{
 for(const value of ['#other=anything','#batch=%zz','#batch=null','#batch='+ 'x'.repeat(60001)])assert.throws(()=>parsePhoneBatch(value));
});
test('diagnostic text removes URLs and token values',()=>{
 const safe=redactDiagnosticText(`Request ${signed} failed token=private-example`);
 assert.ok(!safe.includes('private-example'));assert.ok(!safe.includes('https://'));
});
test('synthetic glare is labelled separately and expects safe no-reading rather than a detected number',()=>{
 const value=valid();value.sources[0].stress='extreme-glare';
 const config=parsePhoneBatch(fragment(value)),source=config.sources[0];
 assert.equal(source.difficulty,'extreme (simulated)');assert.equal(source.expectedOutcome,'no-reading');assert.equal(source.expected,7808.55);
 assert.equal(safePhoneBatch(config).sources[0].stress,'extreme-glare');
});
test('optional trace is disabled by default and explicitly enabled with a boolean',()=>{
 const value=valid();assert.equal(parsePhoneBatch(fragment(value)).trace,false);
 value.trace=true;assert.equal(parsePhoneBatch(fragment(value)).trace,true);
});
test('calibration reports wall/body throughput separately and conservatively checks a requested limit',()=>{
 const resource={startTime:50,fetchStart:50,requestStart:60,responseStart:100,responseEnd:1100,encodedBodySize:CALIBRATION_BYTES,decodedBodySize:CALIBRATION_BYTES,transferSize:CALIBRATION_BYTES+300,workerStart:0};
 const metrics=calibrationMetrics({bytes:CALIBRATION_BYTES,wallMs:1200,resource,expectedIngressBytesPerSecond:CALIBRATION_BYTES});
 assert.equal(metrics.bodyMs,1000);assert.equal(metrics.measuredMbps,.65536);assert.equal(metrics.bodyMbps,.786432);
 assert.equal(metrics.limitAssessment,'consistent-with-requested-limit');assert.equal(metrics.observedToRequestedRatio,1);
 assert.equal(calibrationMetrics({bytes:CALIBRATION_BYTES,wallMs:1200,resource,expectedIngressBytesPerSecond:1000}).limitAssessment,'requested-limit-not-observed');
 assert.equal(calibrationMetrics({bytes:CALIBRATION_BYTES,wallMs:1200,resource,expectedIngressBytesPerSecond:1000000}).limitAssessment,'slower-than-requested');
 assert.equal(calibrationMetrics({bytes:CALIBRATION_BYTES,wallMs:1200,resource:{...resource,transferSize:0},expectedIngressBytesPerSecond:1000}).limitAssessment,'not-verifiable');
 assert.equal(calibrationMetrics({bytes:CALIBRATION_BYTES,wallMs:1200,expectedIngressBytesPerSecond:1000}).limitAssessment,'not-verifiable');
 assert.equal(calibrationMetrics({bytes:CALIBRATION_BYTES,wallMs:1200,resource}).limitAssessment,'not-requested');
 assert.ok(!JSON.stringify(metrics).includes('url'));
});
test('calibration fixture is exactly 96 KiB and not a compressible placeholder',()=>{
 const bytes=fs.readFileSync(new URL('../public/ocr-test/calibration.bin',import.meta.url));
 assert.equal(bytes.length,CALIBRATION_BYTES);assert.equal(new Set(bytes).size,256);
});
