import test from 'node:test';
import assert from 'node:assert/strict';
import {createTotalizerTracer,traceSymbols,traceCandidates} from '../src/totalizer-trace.js';

test('reader trace is bounded and reserves a final event after verbose diagnostics',()=>{
 const events=[];let now=100;
 const trace=createTotalizerTracer(event=>events.push(event),()=>now);
 now=120;for(let i=0;i<200;i++)trace('pass',{value:i});
 trace('final',{outcome:'no-reading',reason:'final-consensus-rejected'},true);
 trace('late',{value:123});
 assert.equal(events.length,120);assert.equal(events[0].elapsedMs,20);
 assert.equal(events.at(-1).stage,'final');assert.equal(events.at(-1).reason,'final-consensus-rejected');
});
test('disabled or throwing trace observers cannot affect recognition control flow',()=>{
 assert.doesNotThrow(()=>createTotalizerTracer(undefined)('pass'));
 const trace=createTotalizerTracer(()=>{throw Error('observer failure');});
 assert.doesNotThrow(()=>trace('pass',{value:151170.97}));
 assert.doesNotThrow(()=>trace('final',{outcome:'detected'},true));
});
test('trace summaries include bounded numeric evidence without image bytes, URLs or arbitrary reader fields',()=>{
 const symbols=traceSymbols([{text:'1https://private.test/?token=secret',confidence:99.123,bbox:{x0:1.123,y0:2,x1:3,y1:4},lcdAmbiguous:true,pixels:'private-bytes',url:'https://private.test'}]);
 assert.equal(symbols[0].text,'1.');assert.equal(symbols[0].confidence,99.1);assert.deepEqual(symbols[0].box,[1.1,2,3,4]);
 const candidates=traceCandidates([{value:151170.97,score:.987654321,url:'https://private.test',pixels:'private-bytes'}]);
 assert.equal(candidates[0].score,.987654);
 const serialized=JSON.stringify({symbols,candidates});
 for(const privateField of ['https','token','secret','private','pixels','url'])assert.ok(!serialized.includes(privateField));
 assert.equal(traceSymbols(Array.from({length:30},()=>({text:'1'}))).length,12);
 assert.equal(traceCandidates(Array.from({length:30},()=>({value:1}))).length,16);
});
