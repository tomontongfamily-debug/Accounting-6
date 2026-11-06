import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gzipSync} from 'node:zlib';
import {parsePhoneBatch,safePhoneBatch,repeatPhoneBatch,redactDiagnosticText,calibrationMetrics,calibrationRequest,validateCalibrationResponse,CALIBRATION_BYTES,LARGE_CALIBRATION_BYTES,CALIBRATION_BYTE_CHOICES,ANDROID_INGRESS_BURST_BYTES,CALIBRATION_LIMIT_TOLERANCE} from '../src/ocr-phone-batch.js';

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
test('automatic repeats default to one and accept only one to three numeric trials',()=>{
 assert.equal(parsePhoneBatch(fragment(valid())).repeat,1);
 for(const repeat of [1,2,3]){
  const config=parsePhoneBatch(fragment({...valid(),repeat}));assert.equal(config.repeat,repeat);assert.equal(safePhoneBatch(config).repeat,repeat);
 }
 for(const repeat of [null,0,-1,4,1.5,'3',true,[]])assert.throws(()=>parsePhoneBatch(fragment({...valid(),repeat})));
});
test('repeated trials preserve source files and metadata while keeping cases in the same order for every trial',()=>{
 const fileA={name:'A.jpg'},fileB={name:'B.jpg'};
 const batch=[{file:fileA,expected:151170.97,difficulty:'easy'},{file:fileB,expected:7808.55,difficulty:'extreme (simulated)',expectedOutcome:'no-reading',transformation:{synthetic:true}}];
 const trials=repeatPhoneBatch(batch,3);
 assert.equal(trials.length,6);assert.deepEqual(trials.map(entry=>[entry.file.name,entry.trial]),[['A.jpg',1],['B.jpg',1],['A.jpg',2],['B.jpg',2],['A.jpg',3],['B.jpg',3]]);
 assert.ok(trials.every(entry=>entry.trialCount===3));assert.equal(trials[4].file,fileA);assert.equal(trials[5].file,fileB);
 assert.equal(trials[5].expectedOutcome,'no-reading');assert.equal(trials[5].transformation,batch[1].transformation);
 assert.ok(batch.every(entry=>entry.trial===undefined));assert.notEqual(trials[0],batch[0]);
 assert.equal(repeatPhoneBatch(batch).length,2);assert.deepEqual(repeatPhoneBatch([],3),[]);
 assert.throws(()=>repeatPhoneBatch(batch,4));
});
test('probe sizes default to 96 KiB and accept only the supported numeric choices',()=>{
 assert.equal(parsePhoneBatch(fragment(valid())).probeBytes,CALIBRATION_BYTES);
 assert.deepEqual(CALIBRATION_BYTE_CHOICES,[98304,196608,262144,1048576]);
 for(const probeBytes of CALIBRATION_BYTE_CHOICES){
  const config=parsePhoneBatch(fragment({...valid(),probeBytes}));
  assert.equal(config.probeBytes,probeBytes);assert.equal(safePhoneBatch(config).probeBytes,probeBytes);
 }
 for(const probeBytes of [null,0,131072,262145,16777216,'262144',true,[]])assert.throws(()=>parsePhoneBatch(fragment({...valid(),probeBytes})));
});
test('192 KiB and 256 KiB requests use exact prefix ranges from the 1 MiB fixture',()=>{
 assert.deepEqual(calibrationRequest(),{path:'/ocr-test/calibration.bin',expectedByteCount:98304,totalByteCount:98304,headers:{}});
 assert.deepEqual(calibrationRequest(196608),{path:'/ocr-test/calibration-large.bin',expectedByteCount:196608,totalByteCount:1048576,headers:{Range:'bytes=0-196607'}});
 assert.deepEqual(calibrationRequest(262144),{path:'/ocr-test/calibration-large.bin',expectedByteCount:262144,totalByteCount:1048576,headers:{Range:'bytes=0-262143'}});
 assert.deepEqual(calibrationRequest(1048576),{path:'/ocr-test/calibration-large.bin',expectedByteCount:1048576,totalByteCount:1048576,headers:{}});
 assert.throws(()=>calibrationRequest(131072));
});
test('calibration accepts full and ranged responses only with the exact requested bytes',()=>{
 for(const expectedByteCount of [CALIBRATION_BYTES,LARGE_CALIBRATION_BYTES]){
  const response=validateCalibrationResponse({status:200,contentRange:null,contentLength:String(expectedByteCount),bytes:expectedByteCount,expectedByteCount});
  assert.equal(response.contentLength,expectedByteCount);assert.equal(response.requestedRange,null);
 }
 const response=validateCalibrationResponse({status:206,contentRange:'bytes 0-262143/1048576',contentLength:'262144',bytes:262144,expectedByteCount:262144});
 assert.deepEqual(response,{status:206,contentRange:'bytes 0-262143/1048576',contentLength:262144,contentEncoding:null,requestedRange:'bytes=0-262143',totalByteCount:1048576});
 // A streaming response can omit Content-Length; its actual byte count and
 // the range total are still checked before measurements are accepted.
 assert.equal(validateCalibrationResponse({status:206,contentRange:'bytes 0-262143/1048576',contentLength:null,bytes:262144,expectedByteCount:262144}).contentLength,null);
});
test('calibration rejects ignored ranges, malformed headers and truncated or oversized bodies',()=>{
 const ranged={status:206,contentRange:'bytes 0-262143/1048576',contentLength:'262144',bytes:262144,expectedByteCount:262144};
 for(const change of [
  {status:200},{status:416},{contentRange:null},{contentRange:'bytes 1-262144/1048576'},
  {contentRange:'bytes 0-262143/262144'},{contentRange:'bytes 0-262143/*'},
  {contentLength:'1048576'},{contentLength:'2.62144e5'},{contentLength:''},
  {bytes:262143},{bytes:1048576},
 ])assert.throws(()=>validateCalibrationResponse({...ranged,...change}));
 assert.throws(()=>validateCalibrationResponse({status:206,contentRange:'bytes 0-98303/98304',contentLength:'98304',bytes:98304}));
 assert.throws(()=>validateCalibrationResponse({status:200,contentRange:'bytes 0-98303/98304',contentLength:'98304',bytes:98304}));
});
test('encoded Content-Length validates wire bytes while the decoded fixture and range remain exact',()=>{
 const bytes=LARGE_CALIBRATION_BYTES,encodedBodySize=bytes+5;
 const input={status:200,contentRange:null,contentLength:String(encodedBodySize),contentEncoding:'br',encodedBodySize,bytes,expectedByteCount:bytes};
 const response=validateCalibrationResponse(input);
 assert.equal(response.contentLength,encodedBodySize);assert.equal(response.contentEncoding,'br');
 assert.throws(()=>validateCalibrationResponse({...input,contentLength:String(bytes)}));
 assert.throws(()=>validateCalibrationResponse({...input,encodedBodySize:undefined}));
 assert.throws(()=>validateCalibrationResponse({...input,bytes:encodedBodySize}));
 assert.throws(()=>validateCalibrationResponse({...input,bytes:bytes-1}));
 assert.equal(validateCalibrationResponse({...input,contentLength:null,encodedBodySize:undefined}).contentLength,null);
 assert.equal(validateCalibrationResponse({...input,contentLength:String(bytes),contentEncoding:'identity'}).contentLength,bytes);
 const ranged={...input,status:206,contentRange:'bytes 0-262143/1048576',contentLength:'262149',encodedBodySize:262149,bytes:262144,expectedByteCount:262144};
 assert.equal(validateCalibrationResponse(ranged).contentLength,262149);
 assert.throws(()=>validateCalibrationResponse({...ranged,contentRange:'bytes 0-262148/1048576'}));
});
const resourceTiming=(bytes,bodyMs)=>({startTime:50,fetchStart:50,requestStart:60,responseStart:100,responseEnd:100+bodyMs,encodedBodySize:bytes,decodedBodySize:bytes,transferSize:bytes+300,workerStart:0});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
test('calibration keeps raw wall/body rates and the Android burst-adjusted lower bound separately',()=>{
 const bytes=LARGE_CALIBRATION_BYTES,rate=125000,minimumMs=(bytes-ANDROID_INGRESS_BURST_BYTES)/rate*1000;
 const metrics=calibrationMetrics({bytes,expectedByteCount:bytes,wallMs:7800,resource:resourceTiming(bytes,minimumMs),expectedIngressBytesPerSecond:rate});
 assert.equal(metrics.bytes,1048576);assert.equal(metrics.expectedByteCount,1048576);
 close(metrics.bodyMs,7340.032);close(metrics.theoreticalMinimumBodyMs,7340.032);
 close(metrics.measuredMbps,1048576*8/7800/1000);close(metrics.bodyMbps,1/.875);close(metrics.burstAdjustedBodyMbps,1);
 close(metrics.observedToRequestedRatio,1);assert.equal(metrics.limitAssessment,'consistent-with-requested-limit');
 assert.equal(metrics.burstModel.assumedBurstBytes,131072);assert.equal(metrics.burstModel.upperRateTolerance,1.3);
 assert.match(metrics.burstModel.source,/android\.googlesource\.com/);assert.match(metrics.burstModel.rateMeaning,/lower bound/);
 assert.match(metrics.interpretation,/without proving enforcement/);
});
test('Brotli overhead keeps a valid decoded 1 MiB probe verifiable and uses wire bytes for rate math',()=>{
 const bytes=LARGE_CALIBRATION_BYTES,encodedBodySize=bytes+5,bodyMs=12026.2;
 const resource={...resourceTiming(bytes,bodyMs),encodedBodySize,transferSize:encodedBodySize+300};
 const metrics=calibrationMetrics({bytes,expectedByteCount:bytes,wallMs:12918,resource,expectedIngressBytesPerSecond:125000});
 assert.equal(metrics.limitAssessment,'consistent-with-requested-limit');
 assert.equal(metrics.resourceTiming.decodedBodySize,bytes);assert.equal(metrics.resourceTiming.encodedBodySize,encodedBodySize);
 close(metrics.bodyMbps,encodedBodySize*8/bodyMs/1000);
 close(metrics.burstAdjustedBodyMbps,(encodedBodySize-ANDROID_INGRESS_BURST_BYTES)*8/bodyMs/1000);
 close(metrics.theoreticalMinimumBodyMs,7340.072);
 assert.equal(calibrationMetrics({...metrics,resource:{...resource,decodedBodySize:bytes-1}}).limitAssessment,'not-verifiable');
});
test('a 96 KiB probe cannot issue a cap verdict while the initial 128 KiB burst covers it',()=>{
 const resource=resourceTiming(CALIBRATION_BYTES,10);
 const metrics=calibrationMetrics({bytes:CALIBRATION_BYTES,wallMs:760,resource,expectedIngressBytesPerSecond:125000});
 close(metrics.measuredMbps,98304*8/760/1000);assert.ok(metrics.bodyMbps>50);
 assert.equal(metrics.burstAdjustedBodyMbps,0);assert.equal(metrics.theoreticalMinimumBodyMs,0);
 assert.equal(metrics.limitAssessment,'not-verifiable');assert.equal(metrics.observedToRequestedRatio,null);
 const boundary=calibrationMetrics({bytes:ANDROID_INGRESS_BURST_BYTES,expectedByteCount:ANDROID_INGRESS_BURST_BYTES,wallMs:100,resource:resourceTiming(ANDROID_INGRESS_BURST_BYTES,1),expectedIngressBytesPerSecond:1});
 assert.equal(boundary.burstAdjustedBodyMbps,0);assert.equal(boundary.limitAssessment,'not-verifiable');
});
test('a slow 256 KiB probe includes the fixed burst rather than treating it as one second of credit',()=>{
 const bytes=262144,rate=16000,resource=resourceTiming(bytes,8192);
 const metrics=calibrationMetrics({bytes,expectedByteCount:bytes,wallMs:8500,resource,expectedIngressBytesPerSecond:rate});
 close(metrics.bodyMbps,.256);close(metrics.burstAdjustedBodyMbps,.128);close(metrics.theoreticalMinimumBodyMs,8192);
 assert.equal(metrics.limitAssessment,'consistent-with-requested-limit');
});
test('a 192 KiB slow probe retains range validation and measures beyond the Android burst',()=>{
 const bytes=196608,rate=16000,bodyMs=4096;
 const response=validateCalibrationResponse({status:206,contentRange:'bytes 0-196607/1048576',contentLength:String(bytes),bytes,expectedByteCount:bytes});
 assert.equal(response.requestedRange,'bytes=0-196607');
 assert.throws(()=>validateCalibrationResponse({status:206,contentRange:'bytes 0-196608/1048576',contentLength:String(bytes),bytes,expectedByteCount:bytes}));
 const metrics=calibrationMetrics({bytes,expectedByteCount:bytes,wallMs:4500,resource:resourceTiming(bytes,bodyMs),expectedIngressBytesPerSecond:rate});
 close(metrics.bodyMbps,.384);close(metrics.burstAdjustedBodyMbps,.128);close(metrics.theoreticalMinimumBodyMs,4096);
 assert.equal(metrics.limitAssessment,'consistent-with-requested-limit');
});
test('the adjusted cap check uses 30 percent tolerance and detects a 100 Mbps body under a requested 50 Mbps cap',()=>{
 assert.equal(CALIBRATION_LIMIT_TOLERANCE,1.3);
 const bytes=LARGE_CALIBRATION_BYTES,rate=125000,remaining=bytes-ANDROID_INGRESS_BURST_BYTES;
 const assess=ratio=>calibrationMetrics({bytes,expectedByteCount:bytes,wallMs:10000,resource:resourceTiming(bytes,remaining/rate/ratio*1000),expectedIngressBytesPerSecond:rate});
 assert.equal(assess(1.29).limitAssessment,'consistent-with-requested-limit');
 assert.equal(assess(1.31).limitAssessment,'requested-limit-not-observed');
 assert.equal(assess(.19).limitAssessment,'slower-than-requested');
 const fast=calibrationMetrics({bytes,expectedByteCount:bytes,wallMs:150,resource:resourceTiming(bytes,bytes/12500000*1000),expectedIngressBytesPerSecond:6250000});
 close(fast.bodyMbps,100);close(fast.burstAdjustedBodyMbps,87.5);close(fast.observedToRequestedRatio,1.75);
 assert.equal(fast.limitAssessment,'requested-limit-not-observed');
});
test('a cap verdict requires exact fixture bytes and usable transfer timing, but raw evidence remains available',()=>{
 const bytes=LARGE_CALIBRATION_BYTES,resource=resourceTiming(bytes,8000),input={bytes,expectedByteCount:bytes,wallMs:8500,resource,expectedIngressBytesPerSecond:125000};
 for(const change of [
  {bytes:bytes-1},{expectedByteCount:CALIBRATION_BYTES},{resource:undefined},
  {resource:{...resource,transferSize:0}},{resource:{...resource,decodedBodySize:bytes-1}},
  {resource:{...resource,decodedBodySize:undefined}},{resource:{...resource,encodedBodySize:0}},
  {resource:{...resource,encodedBodySize:NaN}},{resource:{...resource,encodedBodySize:Infinity}},
  {resource:{...resource,responseEnd:100}},{resource:{...resource,responseEnd:99}},
  {resource:{...resource,responseStart:NaN}},{expectedIngressBytesPerSecond:0},
 ])assert.equal(calibrationMetrics({...input,...change}).limitAssessment,'not-verifiable');
 assert.equal(calibrationMetrics({...input,expectedIngressBytesPerSecond:null}).limitAssessment,'not-requested');
});
test('calibration fixture is exactly 96 KiB and not a compressible placeholder',()=>{
 const bytes=fs.readFileSync(new URL('../public/ocr-test/calibration.bin',import.meta.url));
 assert.equal(bytes.length,CALIBRATION_BYTES);assert.equal(new Set(bytes).size,256);
});
test('large calibration fixture is exactly 1 MiB and resists compression',()=>{
 const bytes=fs.readFileSync(new URL('../public/ocr-test/calibration-large.bin',import.meta.url));
 assert.equal(bytes.length,LARGE_CALIBRATION_BYTES);assert.equal(new Set(bytes).size,256);
 assert.ok(gzipSync(bytes).length>bytes.length*.99);
});
