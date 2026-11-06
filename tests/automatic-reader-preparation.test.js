import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomaticReaderPreparation} from '../src/automatic-reader-preparation.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function setup({primary=async()=>{},advanced=async()=>{},online=true}={}){
 const events=new EventTarget(),document=new EventTarget(),navigator={onLine:online,connection:{effectiveType:'2g',downlink:.1,saveData:true}};
 document.hidden=false;
 const timers=new Map();let next=0,downloadListener,invalidationListener;
 const coordinator=createAutomaticReaderPreparation({primary,advanced,events,document,navigator,
  schedule:(callback,delay)=>{const id=++next;timers.set(id,{callback,delay});return id;},cancel:id=>timers.delete(id),
  getDownload:()=>({stage:'primary',percent:100}),subscribeDownload:listener=>{downloadListener=listener;return()=>{downloadListener=undefined;};},
  subscribeInvalidation:listener=>{invalidationListener=listener;return()=>{invalidationListener=undefined;};}});
 return {coordinator,events,document,navigator,timers,download:value=>downloadListener?.(value),invalidate:()=>invalidationListener?.({primary:true,advanced:true,reason:'recognition-timeout'}),tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback();return timer.delay;}};
}

test('phone preparation starts without a tap on a slow data-saver connection and shares one primary-first job',async()=>{
 const primary=deferred(),advanced=deferred(),calls=[];
 const f=setup({primary:()=>{calls.push('primary');return primary.promise;},advanced:()=>{calls.push('advanced');return advanced.promise;}});
 const snapshots=[];const unsubscribe=f.coordinator.subscribe(snapshot=>snapshots.push(snapshot));
 const stopPhone=f.coordinator.start(),stopPanel=f.coordinator.start();await flush();
 assert.deepEqual(calls,['primary']);assert.equal(f.coordinator.getSnapshot().stage,'primary');
 f.download({stage:'primary',percent:27});assert.equal(f.coordinator.getSnapshot().percent,27);
 primary.resolve();await flush();assert.deepEqual(calls,['primary','advanced']);
 assert.equal(f.coordinator.getSnapshot().primaryReady,true);assert.equal(f.coordinator.getSnapshot().percent,0,'Primary 100% must not masquerade as advanced progress');
 f.download({stage:'primary',percent:100});assert.equal(f.coordinator.getSnapshot().percent,0);
 f.download({stage:'advanced',percent:52});assert.equal(f.coordinator.getSnapshot().percent,52);
 advanced.resolve();await flush();assert.equal(f.coordinator.getSnapshot().stage,'ready');
 assert.equal(f.coordinator.getSnapshot().advancedReady,true);assert.ok(snapshots.some(snapshot=>snapshot.percent===27));
 stopPhone();stopPanel();unsubscribe();assert.equal(f.timers.size,0);
});

test('a primary download failure retries automatically with bounded backoff and never overlaps downloads',async()=>{
 let primaryCalls=0,advancedCalls=0;
 const f=setup({primary:async()=>{if(++primaryCalls<4)throw Error('weak connection');},advanced:async()=>{advancedCalls++;}});
 const stop=f.coordinator.start();await flush();assert.equal(f.coordinator.getSnapshot().stage,'waiting');
 assert.equal(f.tick(),2000);await flush();assert.equal(f.tick(),5000);await flush();
 assert.equal(f.tick(),15000);await flush();assert.equal(f.coordinator.getSnapshot().stage,'ready');
 assert.equal(primaryCalls,4);assert.equal(advancedCalls,1);assert.equal(f.timers.size,0);stop();
});

test('reconnect retries the extra reader without repeating already prepared primary work',async()=>{
 let primaryCalls=0,advancedCalls=0;
 const f=setup({primary:async()=>{primaryCalls++;},advanced:async()=>{if(++advancedCalls===1)throw Error('network interrupted');}});
 const stop=f.coordinator.start();await flush();
 assert.equal(f.coordinator.getSnapshot().primaryReady,true);assert.equal(f.coordinator.getSnapshot().stage,'waiting');assert.equal(f.timers.size,1);
 f.events.dispatchEvent(new Event('online'));f.events.dispatchEvent(new Event('online'));await flush();
 assert.equal(primaryCalls,1);assert.equal(advancedCalls,2);assert.equal(f.coordinator.getSnapshot().stage,'ready');assert.equal(f.timers.size,0);stop();
});

test('offline preparation still tries cached files and resumes on reconnect without offline retry loops',async()=>{
 let primaryCalls=0,advancedCalls=0;
 const f=setup({online:false,primary:async()=>{primaryCalls++;},advanced:async()=>{if(!f.navigator.onLine){advancedCalls++;throw Error('not cached yet');}advancedCalls++;}});
 const stop=f.coordinator.start();await flush();
 assert.equal(primaryCalls,1,'Offline phones can still use verified cached files');assert.equal(advancedCalls,1);assert.equal(f.timers.size,0);
 f.navigator.onLine=true;f.events.dispatchEvent(new Event('online'));await flush();
 assert.equal(primaryCalls,1);assert.equal(advancedCalls,2);assert.equal(f.coordinator.getSnapshot().stage,'ready');stop();
});

test('background pages defer retries until visible and removing every owner stops scheduled retry work',async()=>{
 let calls=0;const f=setup({primary:async()=>{calls++;throw Error('offline');}});
 const stop=f.coordinator.start();await flush();f.document.hidden=true;f.tick();await flush();
 assert.equal(calls,1);assert.equal(f.timers.size,0);
 f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(calls,2);assert.equal(f.timers.size,1);
 stop();stop();assert.equal(f.timers.size,0);f.events.dispatchEvent(new Event('online'));await flush();assert.equal(calls,2);
});

test('unsupported browser capability errors settle visibly without repeating impossible work',async()=>{
 let calls=0;const f=setup({primary:async()=>{calls++;throw Object.assign(Error('no worker'),{reason:'unsupported-browser'});}});
 const stop=f.coordinator.start();await flush();assert.equal(f.coordinator.getSnapshot().stage,'unavailable');assert.equal(f.timers.size,0);
 f.events.dispatchEvent(new Event('online'));f.document.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(calls,1);stop();
});

for(const stage of ['primary','advanced'])test(`unmount and remount during ${stage} preparation keep the same in-flight job and reach ready`,async()=>{
 const waiting=deferred();let primaryCalls=0,advancedCalls=0;
 const f=setup({primary:()=>{primaryCalls++;return stage==='primary'?waiting.promise:Promise.resolve();},advanced:()=>{advancedCalls++;return stage==='advanced'?waiting.promise:Promise.resolve();}});
 const stop=f.coordinator.start();await flush();assert.equal(f.coordinator.getSnapshot().stage,stage);
 stop();const stopAgain=f.coordinator.start();await flush();
 assert.equal(f.coordinator.getSnapshot().stage,stage,'A remount must not invalidate an active preparation into an unrecoverable idle state');
 assert.equal(primaryCalls,1);waiting.resolve();await flush();
 assert.equal(advancedCalls,1);assert.equal(f.coordinator.getSnapshot().stage,'ready');assert.equal(f.timers.size,0);stopAgain();
});

test('worker invalidation clears an old ready badge and automatically warms fresh workers',async()=>{
 let primaryCalls=0,advancedCalls=0;
 const f=setup({primary:async()=>{primaryCalls++;},advanced:async()=>{advancedCalls++;}});
 const stop=f.coordinator.start();await flush();assert.equal(f.coordinator.getSnapshot().stage,'ready');
 f.invalidate();assert.equal(f.coordinator.getSnapshot().primaryReady,false);assert.equal(f.coordinator.getSnapshot().advancedReady,false);
 assert.equal(f.tick(),2000);await flush();
 assert.equal(primaryCalls,2);assert.equal(advancedCalls,2);assert.equal(f.coordinator.getSnapshot().stage,'ready');stop();
});

for(const stage of ['primary','advanced'])test(`invalidation during ${stage} preparation ignores late readiness and retries without overlapping jobs`,async()=>{
 const old=deferred();let primaryCalls=0,advancedCalls=0;
 const f=setup({primary:()=>{primaryCalls++;return stage==='primary'&&primaryCalls===1?old.promise:Promise.resolve();},advanced:()=>{advancedCalls++;return stage==='advanced'&&advancedCalls===1?old.promise:Promise.resolve();}});
 const stop=f.coordinator.start();await flush();assert.equal(f.coordinator.getSnapshot().stage,stage);
 f.invalidate();f.events.dispatchEvent(new Event('online'));await flush();assert.equal(primaryCalls,1,'Do not race a second preparation against the previous one');
 old.resolve();await flush();assert.equal(f.coordinator.getSnapshot().stage,'waiting');assert.equal(f.coordinator.getSnapshot().advancedReady,false);
 f.tick();await flush();assert.equal(f.coordinator.getSnapshot().stage,'ready');assert.equal(primaryCalls,2);assert.equal(advancedCalls,stage==='primary'?1:2);stop();
});

test('an unsupported enhanced engine leaves primary OCR ready without an endless retry loop',async()=>{
 let primaryCalls=0,advancedCalls=0;
 const f=setup({primary:async()=>{primaryCalls++;},advanced:async()=>{advancedCalls++;throw Object.assign(Error('SIMD unavailable'),{reason:'unsupported-browser'});}});
 const stop=f.coordinator.start();await flush();
 assert.equal(f.coordinator.getSnapshot().stage,'primary-only');assert.equal(f.coordinator.getSnapshot().primaryReady,true);assert.equal(f.timers.size,0);
 f.events.dispatchEvent(new Event('online'));f.document.dispatchEvent(new Event('visibilitychange'));await flush();
 assert.equal(primaryCalls,1);assert.equal(advancedCalls,1);
 f.invalidate();f.tick();await flush();
 assert.equal(primaryCalls,2,'A capture timeout must still rewarm the supported primary reader');assert.equal(advancedCalls,1,'Known SIMD incompatibility does not need another download or probe');
 assert.equal(f.coordinator.getSnapshot().stage,'primary-only');stop();
});

test('a remounted phone rechecks workers that may have reset while no surface was listening',async()=>{
 let primaryCalls=0,advancedCalls=0;const f=setup({primary:async()=>{primaryCalls++;},advanced:async()=>{advancedCalls++;}});
 const stop=f.coordinator.start();await flush();stop();
 const stopAgain=f.coordinator.start();await flush();assert.equal(primaryCalls,2);assert.equal(advancedCalls,2);assert.equal(f.coordinator.getSnapshot().stage,'ready');stopAgain();
});

test('a transient primary restart failure does not forget a known enhanced-engine capability limit',async()=>{
 let primaryCalls=0,advancedCalls=0;
 const f=setup({primary:async()=>{if(++primaryCalls===2)throw Object.assign(Error('worker transfer interrupted'),{reason:'worker-failed'});},advanced:async()=>{advancedCalls++;throw Object.assign(Error('SIMD unavailable'),{reason:'unsupported-browser'});}});
 const stop=f.coordinator.start();await flush();assert.equal(f.coordinator.getSnapshot().stage,'primary-only');
 f.invalidate();f.tick();await flush();assert.equal(f.coordinator.getSnapshot().stage,'waiting');
 f.tick();await flush();assert.equal(f.coordinator.getSnapshot().stage,'primary-only');assert.equal(primaryCalls,3);assert.equal(advancedCalls,1);stop();
});
