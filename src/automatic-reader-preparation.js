import {prepareTotalizer,subscribeTotalizerInvalidation} from './totalizer-ocr.js';
import {prepareAdvancedTotalizer} from './totalizer-reader-client.js';
import {readerPreparation,subscribeReaderPreparation} from './ocr-downloads.js';

const RETRY_DELAYS=[2000,5000,15000,30000,60000];

// One preparation job serves the phone, every pump card and price-change panel.
// Primary files finish first so the larger fallback cannot delay ordinary OCR.
// Network type and data-saver hints never require a cashier to tap a setup button.
export function createAutomaticReaderPreparation({
 primary=prepareTotalizer,advanced=prepareAdvancedTotalizer,
 events=globalThis.window,document=globalThis.document,navigator=globalThis.navigator,
 schedule=globalThis.setTimeout,cancel=globalThis.clearTimeout,
 getDownload=readerPreparation,subscribeDownload=subscribeReaderPreparation,
 subscribeInvalidation=subscribeTotalizerInvalidation,
}={}){
 let snapshot={stage:'idle',primaryReady:false,advancedReady:false,percent:0};
 let owners=0,flight,timer,attempt=0,stopDownload,stopInvalidation,blocked=false,advancedUnsupported=false,generation=0;
 const listeners=new Set();
 const publish=patch=>{snapshot={...snapshot,...patch};for(const listener of listeners)listener(snapshot);};
 const clearRetry=()=>{if(timer!==undefined){cancel(timer);timer=undefined;}};
 const visible=()=>!document?.hidden;
 function retryLater(){
  if(!owners||blocked||!visible()||navigator?.onLine===false)return;
  clearRetry();timer=schedule(()=>{timer=undefined;if(visible())run();},RETRY_DELAYS[Math.min(attempt++,RETRY_DELAYS.length-1)]);
 }
 function run(){
  if(flight||!owners||blocked||snapshot.advancedReady||snapshot.primaryReady&&advancedUnsupported)return flight;
  clearRetry();
  const version=generation;
  flight=Promise.resolve().then(async()=>{
   if(version!==generation)return;
   if(!snapshot.primaryReady){
    publish({stage:'primary',percent:0});await primary();
    if(version!==generation)return;publish({primaryReady:true});
   }
   if(advancedUnsupported){publish({stage:'primary-only',percent:100});return;}
   const download=getDownload();
   publish({stage:'advanced',percent:download?.stage==='advanced'?Number(download.percent)||0:0});
   await advanced();if(version!==generation)return;
   attempt=0;publish({stage:'ready',advancedReady:true,percent:100});
  }).catch(error=>{
   if(version!==generation)return;
   const unsupported=error?.reason==='unsupported-browser';
   if(unsupported&&snapshot.primaryReady)advancedUnsupported=true;
   blocked=unsupported&&!snapshot.primaryReady;
   publish({stage:advancedUnsupported&&snapshot.primaryReady?'primary-only':blocked?'unavailable':'waiting'});
  }).finally(()=>{flight=undefined;if(snapshot.stage==='waiting')retryLater();});
  return flight;
 }
 function reconnect(){if(visible())run();else clearRetry();}
 function onInvalidation(){
  // A timed-out or failed worker is no longer ready even when preparation had
  // completed earlier. Ignore any old preparation promise that finishes late.
  generation++;blocked=false;
  publish({stage:'waiting',primaryReady:false,advancedReady:false,percent:0});
  if(!flight)retryLater();
 }
 function onDownload(download){
  if(['primary','advanced'].includes(snapshot.stage)&&download?.stage===snapshot.stage)publish({percent:Math.max(0,Math.min(100,Number(download.percent)||0))});
 }
 function start(){
  owners++;
  if(owners===1){
   // A capture can finish while this surface is unmounted. Recheck the cheap
   // cached worker promises when returning instead of trusting an old badge.
   if(!flight&&(snapshot.primaryReady||blocked)){generation++;blocked=false;publish({stage:'idle',primaryReady:false,advancedReady:false,percent:0});}
   events?.addEventListener('online',reconnect);
   document?.addEventListener('visibilitychange',reconnect);
   stopDownload=subscribeDownload(onDownload);
   stopInvalidation=subscribeInvalidation(onInvalidation);
  }
  run();
  let stopped=false;
  return()=>{
   if(stopped)return;stopped=true;
   owners--;
   if(!owners){
    clearRetry();events?.removeEventListener('online',reconnect);
    document?.removeEventListener('visibilitychange',reconnect);stopDownload?.();stopDownload=undefined;
    stopInvalidation?.();stopInvalidation=undefined;
   }
  };
 }
 return {start,getSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
}

const preparation=createAutomaticReaderPreparation();
export const startAutomaticReaderPreparation=()=>preparation.start();
export const automaticReaderPreparation=()=>preparation.getSnapshot();
export const subscribeAutomaticReaderPreparation=listener=>preparation.subscribe(listener);
