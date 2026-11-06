import {prepareTotalizer,detectTotalizerResult,TOTALIZER_TIMEOUT_MS} from './totalizer-ocr.js';
import {prepareAdvancedTotalizer} from './totalizer-reader-client.js';
import {createAutomaticReaderPreparation} from './automatic-reader-preparation.js';
import {TOTALIZER_VERSION} from './ocr-evidence.js';
import {OCR_ASSET_VERSION} from './ocr-assets.js';
import {parsePhoneBatch,safePhoneBatch,redactDiagnosticText,calibrationMetrics,CALIBRATION_BYTES} from './ocr-phone-batch.js';
import {analyzeTotalizerFrame} from './totalizer-frame-client.js';

// This entry point intentionally imports no station client or report mutation.
// Approved signed photo downloads are converted to local blobs. No photo is
// uploaded; signed links are excluded from diagnostic messages and exports.
const pageStarted=performance.now(),pageStartedAt=new Date().toISOString();
const byId=id=>document.getElementById(id);
const preparationAttempts=[],preparationEvents=[],results=[],errors=[];
let selected=[],running=false,currentPhoto,primaryReadyMs=null,advancedReadyMs=null;
let autoConfig,calibration=null,photoPreload=null,autoPhase='Manual local-photo mode';
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
  return {name:redactDiagnosticText(error?.name||'Error'),message:redactDiagnosticText(error?.message||error||'Unknown error'),
    ...(error?.reason?{reason:redactDiagnosticText(error.reason)}:{}),...(error?.code?{code:redactDiagnosticText(error.code)}:{})};
}
function recordError(source,error){
  const entry={source:redactDiagnosticText(source),at:new Date().toISOString(),elapsedMs:elapsed(),...errorDetails(error)};
  errors.push(entry);
  const item=document.createElement('li');item.textContent=`${entry.source}: ${entry.message}`;byId('errors').append(item);
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
try{autoConfig=parsePhoneBatch(location.hash);}catch(error){recordError('Automatic configuration',error);autoPhase='Automatic configuration rejected';}
// A fragment is never sent in HTTP requests. Remove it from visible history as
// soon as it has been read, before any signed photo download starts.
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
preparation.start();renderPreparation();
function renderCompact(){
  byId('compact-status').textContent=currentPhoto?`${autoPhase} · ${currentPhoto.index}/${currentPhoto.total} ${currentPhoto.name} · ${Math.round(performance.now()-currentPhoto.started)} ms`:autoPhase;
  byId('compact-preparation').textContent=`Setup: primary ${primaryReadyMs===null?'pending':primaryReadyMs+' ms'} · enhanced ${advancedReadyMs===null?'pending':advancedReadyMs+' ms'} (from page open)`;
  byId('compact-probe').textContent=calibration?.status==='complete'?`96 KiB probe: ${calibration.wallMs} ms · ${calibration.measuredMbps?.toFixed(3)??'?'} Mbps · ${calibration.limitAssessment}`:calibration?.status==='error'?'Probe failed; network limit unverified':calibration?.status==='running'?'96 KiB network probe running…':'Probe not run; network label unverified';
}
renderCompact();
setInterval(()=>{
  renderPreparation();renderCompact();
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
  const counts={detected:0,'no-reading':0,error:0};let matched=0,failed=0,safeRefusals=0;
  for(const result of results){counts[result.outcome]++;if(result.expectedOutcome==='detected'&&result.matchesExpectedNumber===true)matched++;if(result.safetyOutcome==='safe-refusal')safeRefusals++;if(result.expectedOutcome==='no-reading'?result.safetyOutcome!=='safe-refusal':result.matchesExpectedNumber===false)failed++;}
  byId('result-summary').textContent=`${results.length} tested · ${counts.detected} detected · ${matched} exact numbers · ${safeRefusals} expected safe refusals · ${failed} failed expectations · ${counts['no-reading']} no reading · ${counts.error} errors`;
  byId('compact-summary').textContent=`${counts.detected} detected · ${matched} exact · ${safeRefusals} safe refusals · ${counts.error} errors · ${failed} failed expectations`;
}
function appendResult(entry){
  results.push(entry);
  const item=document.createElement('li');item.className='result';
  const reading=entry.outcome==='detected'?`Detected ${entry.reading}`:entry.outcome==='no-reading'?'No reading — manual review needed':`Error — ${entry.attempt?.reason||entry.error?.message||'recognition-failed'}`;
  const accuracy=entry.expectedOutcome==='no-reading'?`Expected no reading. ${entry.safetyOutcome==='safe-refusal'?'Safe refusal; not a detected-number success.':'Safety expectation failed.'}`:entry.expected===null?'Expected number not supplied; accuracy unverified.':entry.matchesExpectedNumber?'Expected number matched.':`Expected ${entry.expected}; did not match.`;
  item.textContent=`${entry.file.name}: ${reading}\n${milliseconds(entry.measuredDurationMs)} · target ${milliseconds(entry.targetMs)} · ${entry.readWithinTarget?'reading within target':'no successful reading within target'}\n${accuracy}`;
  byId('results').append(item);renderResults();
  const row=document.createElement('tr');
  for(const value of [`${entry.difficulty||'—'}: ${entry.file.name}`,entry.outcome==='error'?entry.attempt?.reason||'error':entry.outcome,entry.reading??'—',entry.measuredDurationMs,entry.safetyOutcome==='safe-refusal'?'SAFE REFUSAL':entry.expectedOutcome==='no-reading'?'FAIL':entry.matchesExpectedNumber===null?'unverified':entry.matchesExpectedNumber?'MATCH':'FAIL']){
    const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);
  }
  byId('compact-results').append(row);
  if(entry.trace?.length){
    const last=entry.trace.at(-1),passes=entry.trace.filter(event=>event.stage==='primary-pass');
    const texts=[...new Set(passes.map(event=>event.symbols.map(symbol=>symbol.text||'?').join('')))];
    const detailRow=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;
    cell.textContent=`Trace: ${last.reason||last.stage} · OCR ${texts.slice(0,5).join(' / ')||'no digits'} · ${passes.filter(event=>event.confidenceAccepted).length}/${passes.length} confidence passes`;
    detailRow.append(cell);byId('compact-results').append(detailRow);
    const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');
    summary.textContent=`Reader trace: ${entry.file.name} (${entry.trace.length}/120 events)`;
    text.style.whiteSpace='pre-wrap';text.style.fontSize='11px';text.textContent=JSON.stringify(entry.trace,null,2);
    details.append(summary,text);item.append(details);
  }
}
async function runBatch(batch,{targetMs,networkLabel,deviceNote,trace=false}={}){
  if(running||!batch.length)return;
  targetMs??=Number(byId('target-ms').value);networkLabel??=byId('network-label').value;deviceNote??=byId('device-note').value.trim();
  running=true;autoPhase='Reading photos';byId('test-controls').disabled=true;byId('read-photos').disabled=true;
  try{
    for(const [index,{file,expected,difficulty='unspecified',expectedOutcome='detected',transformation=null}]of batch.entries()){
      const started=performance.now();let url;
      currentPhoto={index:index+1,total:batch.length,name:file.name,started};
      const entry={startedAt:new Date().toISOString(),file:{name:file.name,type:file.type,bytes:file.size,lastModified:file.lastModified},
        expected,expectedOutcome,difficulty,transformation,targetMs:difficulty==='easy'?20000:targetMs,deadlineMs:TOTALIZER_TIMEOUT_MS,networkLabel,deviceNote,networkAtStart:network(),
        preparationAtStart:{...preparation.getSnapshot()},primaryReadyMs,advancedReadyMs};
      if(trace)entry.trace=[];
      try{
        if(!file.type.startsWith('image/')&&!/\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name))throw Error('The selected file is not an image.');
        url=URL.createObjectURL(file);
        const result=await detectTotalizerResult(url,{timeoutMs:TOTALIZER_TIMEOUT_MS,
          ...(trace?{onTrace:event=>{if(entry.trace.length<120)entry.trace.push(event);}}:{})});
        entry.reading=result.reading;entry.attempt=result.attempt;
        entry.outcome=result.attempt.status==='detected'&&Number.isFinite(result.reading)?'detected':result.attempt.status==='no-reading'?'no-reading':'error';
      }catch(error){entry.reading=null;entry.outcome='error';entry.error=recordError(`Photo ${file.name}`,error);}
      finally{if(url)URL.revokeObjectURL(url);}
      entry.completedAt=new Date().toISOString();entry.measuredDurationMs=Math.round(performance.now()-started);entry.networkAtEnd=network();
      entry.matchesExpectedNumber=expected===null?null:entry.outcome==='detected'&&Math.abs(entry.reading-expected)<0.000001;
      entry.expectedOutcomeMatched=entry.outcome===expectedOutcome;
      entry.safetyOutcome=expectedOutcome==='no-reading'?(entry.outcome==='no-reading'?'safe-refusal':entry.outcome==='detected'?'unexpected-detection':'error-not-safe-refusal'):'not-a-refusal-test';
      entry.detectedWithinTarget=entry.outcome==='detected'&&entry.measuredDurationMs<=entry.targetMs;
      entry.readWithinTarget=expectedOutcome==='detected'&&entry.detectedWithinTarget;
      entry.accurateWithinTarget=expectedOutcome==='no-reading'?false:expected===null?null:entry.matchesExpectedNumber&&entry.readWithinTarget;
      appendResult(entry);currentPhoto=null;
    }
    autoPhase=`Batch complete · ${batch.length} photos`;
    byId('message').textContent=`Finished ${batch.length} photo(s). Review readings against the originals; download JSON to keep the evidence.`;
  }catch(error){recordError('Batch',error);autoPhase='Batch stopped';byId('message').textContent='The batch stopped. Completed results and errors remain available below.';}
  finally{currentPhoto=null;running=false;byId('test-controls').disabled=false;byId('read-photos').disabled=!selected.length;renderCompact();}
}
byId('read-photos').addEventListener('click',async()=>{
  if(running||!selected.length)return;
  const invalid=selected.find(entry=>entry.expected&&(!/^\d+(?:\.\d{1,2})?$/.test(entry.expected)||!Number.isFinite(Number(entry.expected))));
  if(invalid){byId('message').textContent=`Enter a non-negative number with up to two decimals for ${invalid.file.name}, or leave expected reading blank.`;return;}
  const batch=selected.map(entry=>({...entry,expected:entry.expected===''?null:Number(entry.expected)}));
  const targetMs=Number(byId('target-ms').value),networkLabel=byId('network-label').value,deviceNote=byId('device-note').value.trim();
  await runBatch(batch,{targetMs,networkLabel,deviceNote,trace:autoConfig?.trace===true});
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function approvedPhoto(source){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(source.url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:controller.signal});
    if(!response.ok)throw Error('Approved photo download failed.');
    if(!response.headers.get('Content-Type')?.startsWith('image/'))throw Error('Approved photo was not served as an image.');
    const reader=response.body.getReader(),parts=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20*1024*1024){await reader.cancel();throw Error('Approved photo exceeds the diagnostic size limit.');}parts.push(value);}
    return {file:new File(parts,source.name,{type:response.headers.get('Content-Type')}),expected:source.expected,difficulty:source.difficulty,expectedOutcome:source.expectedOutcome,stress:source.stress};
  }catch{throw Error('Approved photo could not be downloaded. Check link expiry, connectivity and image permissions.');}
  finally{clearTimeout(timer);}
}
async function diagnosticStress(entry){
  if(entry.stress!=='extreme-glare')return entry;
  const started=performance.now(),original=await createImageBitmap(entry.file),canvas=document.createElement('canvas');
  const scale=Math.min(.75,960/Math.max(original.width,original.height));
  canvas.width=Math.max(1,Math.round(original.width*scale));canvas.height=Math.max(1,Math.round(original.height*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.filter='blur(0.8px)';ctx.drawImage(original,0,0,canvas.width,canvas.height);ctx.filter='none';
  const originalDimensions={width:original.width,height:original.height};original.close();
  const {analysis}=await analyzeTotalizerFrame(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
  const regions=analysis.regions.length?analysis.regions:[{x:0,y:0,width:canvas.width,height:canvas.height}];
  const glareBoxes=regions.map(region=>({x:Math.max(0,Math.round(region.x+region.width*.2)),y:Math.max(0,Math.round(region.y-region.height*.25)),
    width:Math.max(1,Math.round(region.width*.6)),height:Math.max(1,Math.round(region.height*1.5))}));
  for(const box of glareBoxes){
    const gradient=ctx.createLinearGradient(box.x,0,box.x+box.width,0);
    gradient.addColorStop(0,'rgba(255,255,255,0)');gradient.addColorStop(.12,'white');gradient.addColorStop(.88,'white');gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=gradient;ctx.fillRect(box.x,box.y,box.width,box.height);
  }
  const derived=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!derived)throw Error('Diagnostic stress image could not be created.');
  return {...entry,file:new File([derived],entry.file.name+' (simulated glare).png',{type:'image/png'}),
    transformation:{kind:'extreme-glare',synthetic:true,description:'Separate local copy: downscale, 0.8px blur and opaque white glare across the middle 60% of detected number rows; central full-height band if no row detected.',
      originalDimensions,derivedDimensions:{width:canvas.width,height:canvas.height},scale,blurPx:.8,glarePlacement:analysis.regions.length?'detected-number-rows':'central-fallback',glareBoxes,durationMs:Math.round(performance.now()-started)}};
}
async function waitForReader(level){
  const started=performance.now();
  while(level!=='none'){
    const state=preparation.getSnapshot();
    if(level==='primary'&&state.primaryReady||level==='enhanced'&&state.advancedReady)return;
    if(state.stage==='unavailable'||level==='enhanced'&&state.stage==='primary-only')throw Error('Requested reader stage is unavailable in this browser.');
    if(performance.now()-started>120000)throw Error('Automatic test stopped waiting for reader preparation.');
    autoPhase=`Waiting for ${level} reader`;await pause(200);
  }
}
async function probeNetwork(expectedIngressBytesPerSecond){
  const started=performance.now(),url=new URL('/ocr-test/calibration.bin',location.origin);
  url.searchParams.set('probe',crypto.randomUUID());
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  calibration={status:'running'};renderCompact();
  try{
    const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:controller.signal});
    if(!response.ok)throw Error('Calibration download failed.');
    const bytes=(await response.arrayBuffer()).byteLength;
    if(bytes!==CALIBRATION_BYTES)throw Error('Calibration file size did not match.');
    const resource=performance.getEntriesByName(url.href).at(-1);
    calibration={status:'complete',...calibrationMetrics({bytes,wallMs:Math.round(performance.now()-started),resource,expectedIngressBytesPerSecond})};
  }catch(error){calibration={status:'error',error:recordError('Network probe',error),limitAssessment:'not-verifiable'};}
  finally{clearTimeout(timer);renderCompact();}
}
async function automaticBatch(config){
  byId('test-controls').disabled=true;byId('read-photos').disabled=true;
  byId('compact-label').textContent=`${config.networkLabel} · ${config.deviceNote||'Device not identified'} · ${config.waitFor==='none'?'capture without waiting for setup':'wait for '+config.waitFor}`;
  autoPhase='Downloading approved photos into local memory';
  try{
    const started=performance.now(),downloaded=await Promise.all(config.sources.map(approvedPhoto));
    // Synthetic stress cases are derived only in this diagnostic page. Original
    // source bytes, station records and production capture behavior are intact.
    const batch=[];for(const entry of downloaded)batch.push(await diagnosticStress(entry));
    photoPreload={durationMs:Math.round(performance.now()-started),count:batch.length,bytes:batch.reduce((sum,entry)=>sum+entry.file.size,0)};
    selected=batch.map(entry=>({...entry,expected:entry.expected===null?'':String(entry.expected)}));
    // Drop the signed links as soon as their approved downloads finish.
    config.sources=config.sources.map(({name,difficulty,expected,stress,expectedOutcome})=>({name,difficulty,expected,stress,expectedOutcome}));
    await waitForReader(config.waitFor);
    const until=performance.now()+config.startDelayMs;
    while(performance.now()<until){autoPhase=`Ready for network limit · batch in ${Math.ceil((until-performance.now())/1000)} s`;await pause(200);}
    autoPhase='Measuring network delivery';await probeNetwork(config.expectedIngressBytesPerSecond);
    await runBatch(batch,{targetMs:30000,networkLabel:config.networkLabel,deviceNote:config.deviceNote,trace:config.trace});
  }catch(error){recordError('Automatic batch',error);autoPhase='Automatic batch stopped';}
  finally{byId('test-controls').disabled=false;byId('read-photos').disabled=!selected.length;renderCompact();}
}
if(autoConfig)automaticBatch(autoConfig);
byId('download-results').addEventListener('click',()=>{
  const report={schemaVersion:2,test:'FuelTech phone-OS OCR check',pageStartedAt,exportedAt:new Date().toISOString(),
    readerVersion:TOTALIZER_VERSION,assetVersion:OCR_ASSET_VERSION,realDeviceVerification:'Operator must identify the physical device/service; user agent alone is not proof.',
    initialEnvironment,currentEnvironment:environment(),primaryReadyMs,advancedReadyMs,preparation:preparation.getSnapshot(),
    automaticBatch:safePhoneBatch(autoConfig),photoPreload,calibration,preparationAttempts,preparationEvents,results,errors,photosIncluded:false,signedUrlsIncluded:false,financialWrites:false};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=`fueltech-phone-ocr-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
});
