import {prepareTotalizer,detectTotalizerResult,TOTALIZER_TIMEOUT_MS} from './totalizer-ocr.js';
import {prepareAdvancedTotalizer} from './totalizer-reader-client.js';
import {createAutomaticReaderPreparation} from './automatic-reader-preparation.js';
import {TOTALIZER_VERSION} from './ocr-evidence.js';
import {OCR_ASSET_VERSION} from './ocr-assets.js';

// This entry point intentionally imports no station client or report mutation.
// Only public OCR assets are fetched. Photo blob URLs never leave the browser.
const pageStarted=performance.now(),pageStartedAt=new Date().toISOString();
const byId=id=>document.getElementById(id);
const preparationAttempts=[],preparationEvents=[],results=[],errors=[];
let selected=[],running=false,currentPhoto,primaryReadyMs=null,advancedReadyMs=null;
const elapsed=()=>Math.round(performance.now()-pageStarted);
const milliseconds=value=>`${(value/1000).toFixed(2)} s`;

function network(){
  const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  return {online:navigator.onLine,effectiveType:connection?.effectiveType??null,
    downlinkMbps:connection?.downlink??null,rttMs:connection?.rtt??null,saveData:connection?.saveData??null};
}
function environment(){
  return {userAgent:navigator.userAgent,userAgentData:navigator.userAgentData?.toJSON?.()??null,
    platform:navigator.platform,hardwareConcurrency:navigator.hardwareConcurrency??null,
    deviceMemoryGiB:navigator.deviceMemory??null,maxTouchPoints:navigator.maxTouchPoints??null,
    screen:{width:screen.width,height:screen.height,pixelRatio:devicePixelRatio},
    viewport:{width:innerWidth,height:innerHeight},secureContext:isSecureContext,network:network()};
}
const initialEnvironment=environment();
function errorDetails(error){
  return {name:error?.name||'Error',message:String(error?.message||error||'Unknown error'),
    ...(error?.reason?{reason:String(error.reason)}:{}),...(error?.code?{code:String(error.code)}:{})};
}
function recordError(source,error){
  const entry={source,at:new Date().toISOString(),elapsedMs:elapsed(),...errorDetails(error)};
  errors.push(entry);
  const item=document.createElement('li');item.textContent=`${source}: ${entry.message}`;byId('errors').append(item);
  return entry;
}
async function prepare(stage,action){
  const entry={stage,startedAt:new Date().toISOString(),startedMs:elapsed(),network:network(),status:'preparing'};
  preparationAttempts.push(entry);
  try{
    const value=await action();entry.status='ready';
    if(stage==='primary'&&primaryReadyMs===null)primaryReadyMs=elapsed();
    if(stage==='advanced'&&advancedReadyMs===null)advancedReadyMs=elapsed();
    return value;
  }catch(error){entry.status='error';entry.error=recordError(`${stage} preparation`,error);throw error;}
  finally{entry.completedAt=new Date().toISOString();entry.durationMs=elapsed()-entry.startedMs;}
}
// Use the same automatic coordinator and real preparation functions as the app,
// wrapping only their timings/errors. No manual prepare action is exposed.
const preparation=createAutomaticReaderPreparation({
  primary:()=>prepare('primary',()=>prepareTotalizer()),
  advanced:()=>prepare('advanced',()=>prepareAdvancedTotalizer()),
});
function renderPreparation(snapshot=preparation.getSnapshot()){
  const percent=Math.round(snapshot.percent||0);
  const labels={idle:'Starting automatically…',primary:`Preparing primary reader · ${percent}%`,
    advanced:`Primary reader ready. Preparing enhanced reader · ${percent}%`,
    ready:'Primary and enhanced readers ready.',
    'primary-only':'Primary reader ready. Enhanced reader is unavailable in this browser.',
    waiting:snapshot.primaryReady?'Primary reader ready. Enhanced preparation will retry automatically.':'Preparation will retry automatically when this page is visible and connected.',
    unavailable:snapshot.primaryReady?'Primary reader ready. Enhanced reader unavailable in this browser.':'Reader unavailable in this browser.'};
  byId('preparation-status').textContent=labels[snapshot.stage]||snapshot.stage;
  byId('preparation-progress').value=percent;
  byId('preparation-timing').textContent=[`Page open: ${milliseconds(elapsed())}`,
    `Primary ready: ${primaryReadyMs===null?'waiting':milliseconds(primaryReadyMs)}`,
    `Enhanced ready: ${advancedReadyMs===null?'waiting':milliseconds(advancedReadyMs)}`].join(' · ');
}
preparation.subscribe(snapshot=>{
  preparationEvents.push({elapsedMs:elapsed(),at:new Date().toISOString(),...snapshot});renderPreparation(snapshot);
});
window.addEventListener('error',event=>recordError('Browser error',event.error||event.message));
window.addEventListener('unhandledrejection',event=>recordError('Unhandled promise',event.reason));
window.addEventListener('online',()=>renderPreparation());
window.addEventListener('offline',()=>renderPreparation());
byId('engine-version').textContent=`Reader ${TOTALIZER_VERSION} · assets ${OCR_ASSET_VERSION}`;
preparation.start();renderPreparation();
setInterval(()=>{
  renderPreparation();
  if(currentPhoto)byId('message').textContent=`Reading ${currentPhoto.index}/${currentPhoto.total}: ${currentPhoto.name} · ${milliseconds(performance.now()-currentPhoto.started)} / 30 s`;
},250);

byId('photos').addEventListener('change',event=>{
  selected=[...event.target.files].map(file=>({file,expected:''}));
  byId('selected-photos').replaceChildren();
  for(const entry of selected){
    const item=document.createElement('li'),name=document.createElement('span'),label=document.createElement('label'),input=document.createElement('input');
    name.className='photo-name';name.textContent=entry.file.name;
    label.textContent='Expected reading (optional)';input.type='text';input.inputMode='decimal';input.placeholder='For example: 7808.55';
    input.addEventListener('input',()=>{entry.expected=input.value.trim();});
    label.append(input);item.append(name,label);byId('selected-photos').append(item);
  }
  byId('read-photos').disabled=!selected.length||running;
  byId('message').textContent=selected.length?`${selected.length} photo(s) selected. Preparation continues automatically.`:'';
});
function renderResults(){
  const counts={detected:0,'no-reading':0,error:0};let matched=0,failed=0;
  for(const result of results){counts[result.outcome]++;if(result.matchesExpected===true)matched++;if(result.matchesExpected===false)failed++;}
  byId('result-summary').textContent=`${results.length} tested · ${counts.detected} detected · ${matched} matched expected · ${failed} differed · ${counts['no-reading']} no reading · ${counts.error} errors`;
}
function appendResult(entry){
  results.push(entry);
  const item=document.createElement('li');item.className='result';
  const reading=entry.outcome==='detected'?`Detected ${entry.reading}`:entry.outcome==='no-reading'?'No reading — manual review needed':`Error — ${entry.attempt?.reason||entry.error?.message||'recognition-failed'}`;
  const accuracy=entry.expected===null?'Expected number not supplied; accuracy unverified.':entry.matchesExpected?'Expected number matched.':`Expected ${entry.expected}; did not match.`;
  item.textContent=`${entry.file.name}: ${reading}\n${milliseconds(entry.measuredDurationMs)} · target ${milliseconds(entry.targetMs)} · ${entry.readWithinTarget?'reading within target':'no successful reading within target'}\n${accuracy}`;
  byId('results').append(item);renderResults();
}
byId('read-photos').addEventListener('click',async()=>{
  if(running||!selected.length)return;
  const invalid=selected.find(entry=>entry.expected&&(!/^\d+(?:\.\d{1,2})?$/.test(entry.expected)||!Number.isFinite(Number(entry.expected))));
  if(invalid){byId('message').textContent=`Enter a non-negative number with up to two decimals for ${invalid.file.name}, or leave expected reading blank.`;return;}
  const batch=selected.map(({file,expected})=>({file,expected:expected===''?null:Number(expected)}));
  const targetMs=Number(byId('target-ms').value),networkLabel=byId('network-label').value,deviceNote=byId('device-note').value.trim();
  running=true;byId('test-controls').disabled=true;byId('read-photos').disabled=true;
  try{
    for(const [index,{file,expected}]of batch.entries()){
      const started=performance.now();let url;
      currentPhoto={index:index+1,total:batch.length,name:file.name,started};
      const entry={startedAt:new Date().toISOString(),file:{name:file.name,type:file.type,bytes:file.size,lastModified:file.lastModified},
        expected,targetMs,deadlineMs:TOTALIZER_TIMEOUT_MS,networkLabel,deviceNote,networkAtStart:network(),
        preparationAtStart:{...preparation.getSnapshot()},primaryReadyMs,advancedReadyMs};
      try{
        if(!file.type.startsWith('image/')&&!/\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name))throw Error('The selected file is not an image.');
        url=URL.createObjectURL(file);
        const result=await detectTotalizerResult(url,{timeoutMs:TOTALIZER_TIMEOUT_MS});
        entry.reading=result.reading;entry.attempt=result.attempt;
        entry.outcome=result.attempt.status==='detected'&&Number.isFinite(result.reading)?'detected':result.attempt.status==='no-reading'?'no-reading':'error';
      }catch(error){entry.reading=null;entry.outcome='error';entry.error=recordError(`Photo ${file.name}`,error);}
      finally{if(url)URL.revokeObjectURL(url);}
      entry.completedAt=new Date().toISOString();entry.measuredDurationMs=Math.round(performance.now()-started);entry.networkAtEnd=network();
      entry.matchesExpected=expected===null?null:entry.outcome==='detected'&&Math.abs(entry.reading-expected)<0.000001;
      entry.readWithinTarget=entry.outcome==='detected'&&entry.measuredDurationMs<=targetMs;
      entry.accurateWithinTarget=expected===null?null:entry.matchesExpected&&entry.readWithinTarget;
      appendResult(entry);currentPhoto=null;
    }
    byId('message').textContent=`Finished ${batch.length} photo(s). Review readings against the originals; download JSON to keep the evidence.`;
  }catch(error){recordError('Batch',error);byId('message').textContent='The batch stopped. Completed results and errors remain available below.';}
  finally{currentPhoto=null;running=false;byId('test-controls').disabled=false;byId('read-photos').disabled=!selected.length;}
});
byId('download-results').addEventListener('click',()=>{
  const report={schemaVersion:1,test:'FuelTech physical-phone OCR check',pageStartedAt,exportedAt:new Date().toISOString(),
    readerVersion:TOTALIZER_VERSION,assetVersion:OCR_ASSET_VERSION,realDeviceVerification:'Operator must identify the physical device/service; user agent alone is not proof.',
    initialEnvironment,currentEnvironment:environment(),primaryReadyMs,advancedReadyMs,preparation:preparation.getSnapshot(),
    preparationAttempts,preparationEvents,results,errors,photosIncluded:false,financialWrites:false};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=`fueltech-phone-ocr-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
});
