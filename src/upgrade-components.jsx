import {captureKey,keepPumpCapture,readPumpCapture,forgetPumpCapture} from './pump-capture-store.js';
import {finalizePumpPhotoInput,captureDuration} from './pump-capture-flow.js';
import {MeterReadingEditor} from './meter-reading-editor.jsx';
import {ReadingFinalConfirmation} from './reading-final-confirmation.jsx';
import {rememberMeterPhoto} from './meter-photo-preview.js';
import { pilotPost } from './pilot-client.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { detectTotalizerResult as detect } from './totalizer-ocr.js';
import {totalizerFormatForStation,formatTotalizerSuggestion} from './totalizer-formats.js';
import {automaticReaderPreparation,subscribeAutomaticReaderPreparation,startAutomaticReaderPreparation} from './automatic-reader-preparation.js';
import { ERROR_CATEGORIES, denominationTotal, readingComplete, readingWarning,isHighVariance,highVarianceMessage } from './error-reduction.ts';
import './upgrade.css';
import { AdminDepositCards } from './admin-deposits.jsx';
import { midShiftPumpKey, midShiftPhotoRow } from './mid-shift-price-change.js';
import { PendingVouchers } from './pending-vouchers.jsx';
import { CashDenominations } from './cash-denominations.jsx';
import { ShiftReasons, reasonLabel } from './shift-health.jsx';
import { ManagerDepositCards } from './deposit-cards.jsx';
import { depositCoverage, depositDayLabel } from './deposit-coverage.js';
import { DepositCoverageLines } from './deposit-coverage.jsx';
import { pumpSalesBreakdown } from './fuel-leak-loss.js';
import { compute } from './accounting-engine.js';
import { usePhoneView } from './phone-view.js';
const php=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
const keyOf=r=>`${r.branch}__${r.date}__${r.shiftId}`;
function PumpSales({report,row}) {
  const sales=pumpSalesBreakdown(report,row);
  return <div className="pump-sales" aria-label={`${row.pump} ${row.nozzle} sales`}>
    <p>Metered: <b>{sales.meteredLiters.toFixed(2)} L</b> · Leak loss: <b>{sales.lossLiters.toFixed(2)} L</b></p>
    {sales.excessLoss?<p className="error" role="alert">Leak loss exceeds the metered liters. Check the loss entry; the pump reading is still saved.</p>:<p>Paid sales: <b>{sales.paidLiters.toFixed(2)} L</b> · <b>{php(sales.paidSales)}</b>{sales.lossLiters>0&&sales.paidLiters<0.000001?' — all metered liters are recorded as loss.':''}</p>}
  </div>;
}
export async function demoApi(path,body={},options) {
  const value=await pilotPost(`/api/demo/${path}`,body,'',options);
  if (['deposit-submit','deposit-verify','settings'].includes(path)) window.dispatchEvent(new Event('fueltech-pilot-change'));
  return value;
}
export async function savePumpReading(report,row,options) {
  return demoApi('pump-reading',{reportKey:keyOf(report),row,revision:row.readingRevision||0},options);
}
export function PhotoReading({row,report,onConfirm,locked,onBusy,change,onPrepare,opening=false,recognize=detect}) {
  const phoneView=usePhoneView();
  const format=totalizerFormatForStation(report.branch);
  const [photo,setPhoto]=useState(row.photo_path||'');const [detected,setDetected]=useState(row.ocr_detected_reading??null);
  const [ocrResult,setOcrResult]=useState(row.ocr_result);
  const [draft,setDraft]=useState(row.readingConfirmed?String(row.closing):row.ocr_detected_reading==null?'':formatTotalizerSuggestion(row.ocr_detected_reading,format));const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [finalConfirmation,setFinalConfirmation]=useState(null);
  const confirming=useRef(false);
  const [uploading,setUploading]=useState(false);
  const [captureStage,setCaptureStage]=useState('photo');const [elapsed,setElapsed]=useState(0);
  const [retryCapture,setRetryCapture]=useState(null);
  const [pendingPhoto,setPendingPhoto]=useState('');const [liveReading,setLiveReading]=useState(null);const [liveStatus,setLiveStatus]=useState('');
  const [nativeCamera,setNativeCamera]=useState(false);const [retryReadingCapture,setRetryReadingCapture]=useState(null);
  const [camera,setCamera]=useState(false);const [openingCamera,setOpeningCamera]=useState(false);const video=useRef(null);const fileInput=useRef(null);const stream=useRef(null);const active=useRef(true);
  const captureInFlight=useRef(false);
  const currentCapture=useRef(null);
  const photoImage=useRef(null);
  const localCaptureKey=captureKey(report,row,change);
  useEffect(()=>{
    let mounted=true;
    if(!locked)readPumpCapture(localCaptureKey).then(capture=>{
      if(!mounted||captureInFlight.current||!capture)return;
      if(row.readingConfirmed){forgetPumpCapture(localCaptureKey);return;}
      setRetryCapture(capture);setPendingPhoto(capture.data);
      if(capture.result){setDetected(capture.result.reading);setOcrResult(capture.result.attempt);setLiveReading(capture.result.reading);}
      setError('An unfinished capture was restored on this device. Retry saving it; no retake is needed.');
    });
    return()=>{mounted=false;};
  },[localCaptureKey,locked]);
  const recognitionRun=useRef(0);
  useEffect(()=>{active.current=true;return()=>{active.current=false;stream.current?.getTracks().forEach(t=>t.stop());};},[]);
  useEffect(()=>{if(camera&&video.current)video.current.srcObject=stream.current;},[camera]);
  const revision=useRef(row.readingRevision||0);
  useEffect(()=>{onBusy?.(row.id,busy||camera||openingCamera||!!retryCapture,uploading||camera||openingCamera);return()=>onBusy?.(row.id,false,false);},[busy,uploading,camera,openingCamera,retryCapture,onBusy,row.id]);
  useEffect(()=>{
    if(!busy)return;
    const started=Date.now();setElapsed(0);
    const timer=window.setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);
    return()=>window.clearInterval(timer);
  },[busy]);
  useEffect(()=>{
    if(busy || Number(row.readingRevision||0)===revision.current)return;
    revision.current=Number(row.readingRevision||0);setPhoto(row.photo_path||'');setDetected(row.ocr_detected_reading??null);setOcrResult(row.ocr_result);setDraft(row.readingConfirmed?String(row.closing):row.ocr_detected_reading==null?'':String(row.ocr_detected_reading));setEditing(false);
  },[row,busy,format]);
  async function saveReading(next,savedPhoto,options) {
    // Photo upload already committed this report. Reuse that response to show
    // the saved evidence without another mutation or waiting for recognition.
    const saved=await onConfirm({...next,readingRevision:options?.readingRevision??revision.current},savedPhoto,options);
    revision.current=Number(saved.readingRevision||0);
    return saved;
  }
  const warning=opening
    ? {level:'NORMAL',liters:0,blocked:draft===''||!Number.isFinite(Number(draft))||Number(draft)<0||Number(draft)>1e12,message:'This confirmed number becomes the starting pump reading.'}
    : readingWarning({...row,closing:draft});
  if(change && row.finalClosing!=='' && row.finalClosing!=null && Number(draft)>Number(row.finalClosing)) {warning.blocked=true;warning.message='Price-change reading cannot exceed the confirmed shift closing.';}
  function processPhoto(data,recognitionImage=data,startedAtMs=Date.now()) {
    return resumeCapture({data,sourceRow:row,expectedRevision:revision.current,photoMutationId:crypto.randomUUID(),startedAtMs},recognitionImage);
  }
  async function resumeCapture(capture,recognitionImage) {
    capture.discarded=false;
    currentCapture.current=capture;
    const run=++recognitionRun.current;
    let retain=false;
    setBusy(true);setUploading(!capture.saved);setCaptureStage(capture.saved?'reading':'photo');setRetryCapture(null);setError('');setDraft('');setDetected(null);setOcrResult(undefined);setEditing(false);
    setPendingPhoto(capture.data);setLiveReading(null);setLiveStatus('');setRetryReadingCapture(null);
    try {
      if(capture.data.length>2800000) throw Error('Photo is too large. Move closer and take another photo.');
      // Recognize locally while the photo uploads, instead of waiting through
      // several server round trips before starting the OCR worker.
      const recognition=capture.recognition ||= capture.result?Promise.resolve(capture.result):recognize(recognitionImage||capture.data,{format});
      recognition.then(result=>{
        if(capture.discarded||currentCapture.current!==capture)return;
        capture.captureToReadingMs??=captureDuration(capture);
        capture.result=result;keepPumpCapture(localCaptureKey,capture,{onlyIfCurrent:true});
        const {reading,attempt}=result;
        if(active.current&&currentCapture.current===capture){setDetected(reading);setOcrResult(attempt);setLiveReading(Number.isFinite(reading)?reading:null);setLiveStatus(attempt?.status||'');}
      },()=>{});
      await keepPumpCapture(localCaptureKey,capture);
      if(!capture.saved){
        const photoStarted=performance.now();
        await onPrepare?.();
        if(!capture.photoInput){
          capture.photoInput={reportKey:keyOf(report),rowId:row.id,data:capture.data,replaceReading:true,revision:capture.expectedRevision,...(change?{changeId:change.id,product:change.product,effectiveTime:change.effectiveTime,pumpKey:midShiftPumpKey(row)}: {})};
          capture.photoInputFinalized=false;
        }
        capture.saved=await demoApi('photo',capture.photoInput,{mutationId:capture.photoMutationId,
          prepareInput:snapshot=>finalizePumpPhotoInput(capture,snapshot,current=>keepPumpCapture(localCaptureKey,current))});
        capture.expectedRevision=Number(capture.saved.readingRevision);
        revision.current=capture.expectedRevision;
        capture.photoSaveMs=Math.round(performance.now()-photoStarted);
        await keepPumpCapture(localCaptureKey,capture);
      }
      const saved=capture.saved;
      if(!active.current)return;setPhoto(saved.photo_path);
      // Photo upload atomically invalidates the old confirmation. Persist the
      // suggestion in one reading save, using the revision returned by upload.
      if(!capture.applied){
        const uploadedRow={...capture.sourceRow,photo_path:saved.photo_path,readingConfirmed:false,closingEntered:false,closing:'',ocr_detected_reading:null};
        await saveReading(uploadedRow,saved);capture.applied=true;
      }
      if(!active.current)return;
      setUploading(false);setCaptureStage('reading');
      const result=await recognition,value=result.reading,attempt={...result.attempt,photoSaveMs:capture.photoSaveMs,captureToReadingMs:capture.captureToReadingMs};
      if(!active.current)return;setDetected(value);setOcrResult(attempt);setDraft(value===null?'':formatTotalizerSuggestion(value,format));
      setCaptureStage('reading-save');
      const saveStarted=performance.now();
      // Freeze the exact input and ID across explicit retries. A lost response
      // can already have committed; the server receipt returns that same save.
      if(!saved.ocrPersisted){
        capture.readingInput||={...capture.sourceRow,photo_path:saved.photo_path,readingConfirmed:false,closingEntered:false,closing:'',ocr_detected_reading:value,ocr_result:attempt};
        capture.readingOptions||={mutationId:crypto.randomUUID(),readingRevision:capture.expectedRevision};
        await keepPumpCapture(localCaptureKey,capture);
        await saveReading(capture.readingInput,undefined,capture.readingOptions);
      }
      capture.discarded=true;await forgetPumpCapture(localCaptureKey,capture.photoMutationId);
      capture.expectedRevision=revision.current;
      if(active.current)setOcrResult({...attempt,readingSaveMs:saved.ocrPersisted?0:Math.round(performance.now()-saveStarted),captureToReadyMs:captureDuration(capture)});
      if(value===null&&attempt.status==='error')setRetryReadingCapture(capture);
      if(value===null)setEditing(false);
    } catch(e) {
      // Keep an interrupted upload even when its commit result is uncertain.
      // Same-ID retries keep the receipt and original nozzle revision checks.
      retain=e.status>=500||e.saveUncertain===true
        ||e.status===409&&(e.retryableConflict===true||/^Another device saved first\./.test(e.message||''));
      if(retain){await keepPumpCapture(localCaptureKey,capture);setRetryCapture(capture);if(capture.result){setDetected(capture.result.reading);setOcrResult(capture.result.attempt);}setError(capture.saved?'The station server could not verify the reading save. Your capture is kept on this screen. Retry saving; no retake is needed.':'The station server could not verify this photo save. Your capture is kept on this screen. Retry saving when the connection recovers.');}
      else {capture.discarded=true;await forgetPumpCapture(localCaptureKey,capture.photoMutationId);setError(e.message);}
    }finally{if(active.current&&recognitionRun.current===run){recognitionRun.current++;setBusy(false);setUploading(false);if(!retain){setPendingPhoto('');setLiveReading(null);}}}
  }
  async function retryAutomaticReading(){
    if(retryReadingCapture){
      const capture=retryReadingCapture;capture.recognition=null;delete capture.result;delete capture.readingInput;delete capture.readingOptions;
      if(capture.saved)capture.saved={...capture.saved,ocrPersisted:false};
      return resumeCapture(capture);
    }
    setBusy(true);setError('');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(photo,{credentials:'same-origin',signal:controller.signal});
      if(!response.ok)throw Error('The saved photo could not be loaded. Reconnect and retry.');
      const blob=await response.blob();
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      if(!active.current)return;
      const savedRow={...row,photo_path:photo};
      return await resumeCapture({data,sourceRow:savedRow,expectedRevision:revision.current,photoMutationId:crypto.randomUUID(),saved:{photo_path:photo,readingRevision:revision.current,report:{...report,pumpRows:report.pumpRows.map(r=>r.id===row.id?savedRow:r)}},applied:true});
    }catch(e){if(active.current)setError(e.name==='AbortError'?'The saved photo took too long to download. Reconnect and retry.':e.message);}
    finally{clearTimeout(timer);if(active.current)setBusy(false);}
  }
  async function openCamera() {
    setError('');
    if(!navigator.mediaDevices?.getUserMedia){
      if(phoneView){setNativeCamera(true);setError('Live camera is unavailable in this browser. Use your phone camera below, or open this page in Chrome or Safari.');}
      else fileInput.current?.click();
      return;
    }
    setOpeningCamera(true);
    try {
      const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
      if(!active.current){opened.getTracks().forEach(t=>t.stop());return;}
      stream.current=opened;setCamera(true);
    }catch{if(active.current){if(phoneView)setNativeCamera(true);setError(phoneView?'Live camera access is unavailable. Use your phone camera below, or allow camera access in your browser settings.':'Camera access is unavailable. Use the photo picker below.');}}
    finally{if(active.current)setOpeningCamera(false);}
  }
  async function capture() {
    const v=video.current;if(!v?.videoWidth||captureInFlight.current)return;
    const startedAtMs=Date.now();captureInFlight.current=true;setBusy(true);setUploading(true);setCaptureStage('photo');
    try{
      // Dimensions can be available before the first camera image is presented.
      // Wait for real frames and encode them while the source track is alive.
      if(v.requestVideoFrameCallback)await new Promise(resolve=>{
        let frames=0,frame;
        const finish=()=>{window.clearTimeout(timer);if(frame!==undefined)v.cancelVideoFrameCallback?.(frame);resolve();};
        const next=()=>{if(++frames>=2)finish();else frame=v.requestVideoFrameCallback(next);};
        const timer=window.setTimeout(finish,500);frame=v.requestVideoFrameCallback(next);
      });
      if(!active.current||!v.srcObject?.active)return;
      const canvas=document.createElement('canvas'),scale=Math.min(1,1800/Math.max(v.videoWidth,v.videoHeight));
      canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(v,0,0,canvas.width,canvas.height);
      const recognitionImage=context.getImageData(0,0,canvas.width,canvas.height);
      let data;
      for(const quality of[.95,.9,.85,.8]){data=canvas.toDataURL('image/jpeg',quality);if(data.length<=2700000)break;}
      stream.current?.getTracks().forEach(t=>t.stop());setCamera(false);await processPhoto(data,recognitionImage,startedAtMs);
    }catch{if(active.current)setError('The camera frame was not ready. Please capture the photo again.');}
    finally{captureInFlight.current=false;if(active.current){setBusy(false);setUploading(false);}}
  }
  async function selectPhoto(event) {
    if(phoneView&&!nativeCamera&&!change)return;
    const file=event.target.files?.[0];if(!file)return;
    if(captureInFlight.current)return;
    const startedAtMs=Date.now();captureInFlight.current=true;setBusy(true);setUploading(true);setCaptureStage('photo');
    try {
      const url=URL.createObjectURL(file),bitmap=new Image();
      try{
        await new Promise((resolve,reject)=>{
          const timer=window.setTimeout(()=>reject(Error('Photo could not be opened.')),10000);
          bitmap.onload=()=>{window.clearTimeout(timer);resolve();};bitmap.onerror=()=>{window.clearTimeout(timer);reject(Error('Photo could not be opened.'));};bitmap.src=url;
        });
        const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        await processPhoto(canvas.toDataURL('image/jpeg',.92),context.getImageData(0,0,canvas.width,canvas.height),startedAtMs);
      }finally{URL.revokeObjectURL(url);event.target.value='';}
    }catch{if(active.current)setError('This image could not be opened. Please take another photo.');}
    finally{captureInFlight.current=false;if(active.current){setBusy(false);setUploading(false);}}
  }
  function askToConfirm(){
    if(busy||locked||retryCapture||!photo||draft===''||warning.blocked)return;
    rememberMeterPhoto(photo,photoImage.current);
    setFinalConfirmation({reading:draft,photo,revision:revision.current});
  }
  async function confirm() {
    if(!finalConfirmation||confirming.current||busy)return;
    if(locked||retryCapture||warning.blocked||!photo||draft===''||finalConfirmation.photo!==photo||finalConfirmation.reading!==draft||finalConfirmation.revision!==revision.current){
      setFinalConfirmation(null);setError('This reading changed. Check the photo and number again before confirming.');return;
    }
    confirming.current=true;setFinalConfirmation(null);setCaptureStage('confirmation-save');
    setBusy(true);setError('');
    try {await saveReading({...row,closing:Number(draft),closingEntered:true,closingEntrySource:'cashier',photo_path:photo,ocr_detected_reading:detected,ocr_result:ocrResult,ocr_was_edited:detected!==null&&Number(draft)!==detected,readingConfirmed:true,confirmed_closing_reading:Number(draft),calculated_liters:warning.liters,reading_warning:warning.level});
    setEditing(false);
    } catch(e){setError(e.message);} finally{confirming.current=false;setBusy(false);}
  }
  async function editReading() {
    rememberMeterPhoto(photo,photoImage.current);
    // A suggestion is not an official number yet. Open its editor locally;
    // only an already confirmed number needs the existing server unlock.
    if(!row.readingConfirmed){setEditing(true);setError('');return;}
    setBusy(true);setError('');try{await saveReading({...row,readingConfirmed:false});setEditing(true);}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <article className={`reading-card ${readingComplete(row)?'complete':''}`} data-pump-row-id={row.id}>
    <header><div><strong>{change?`${row.pump} · ${row.nozzle}`:row.nozzle}</strong><small>{opening?`${row.product} · Starting totalizer reading`:<>{row.product} · Opening {Number(row.opening).toLocaleString('en-PH',{minimumFractionDigits:2})} 🔒</>}</small></div><b>{pendingPhoto?busy?'Saving…':'Save pending':readingComplete(row)?'✓ Complete':photo?'Photo saved · Confirm reading':'Photo required'}</b></header>
    {(pendingPhoto||photo)&&!editing&&<img ref={photoImage} src={pendingPhoto||photo} alt={`${row.pump} ${row.nozzle} totalizer`} className="totalizer-photo"/>}
    {photo&&row.readingConfirmed&&locked&&<p className="success-box">✓ Reading confirmed and saved: <strong>{Number(row.closing).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3})}</strong></p>}
    {camera&&<div><p>Fill the guide with all digits and the decimal point. Move closer and tilt the phone until reflections leave the digits.</p><div className="totalizer-camera"><video ref={video} autoPlay playsInline muted/><div className="totalizer-camera-guide" aria-hidden="true"/></div><button type="button" onClick={capture}>Capture photo</button><button type="button" onClick={()=>{stream.current?.getTracks().forEach(t=>t.stop());setCamera(false);}}>Cancel camera</button></div>}
    {!locked&&<><div className="demo-actions"><button type="button" className="primary" disabled={busy||camera||openingCamera} onClick={openCamera}>{openingCamera?'Opening camera…':photo||pendingPhoto?'Retake photo':'Open camera'}</button>{(change||!phoneView||nativeCamera)&&<label className="photo-picker">{change?'Choose price-change photo':phoneView?'Use phone camera':'Take / choose photo'}<input ref={fileInput} type="file" accept="image/*" capture={phoneView&&!change?'environment':undefined} onChange={selectPhoto} disabled={busy}/></label>}</div>
    {busy&&<p role="status">{captureStage==='confirmation-save'?<>Saving your confirmed reading: <strong>{draft}</strong>…</>:liveReading!==null?<>Reading found: <strong>{Number(liveReading).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3})}</strong>. {captureStage==='reading-save'?'Photo saved. Saving the reading to the station…':'Saving photo and reading…'}</>:captureStage==='reading-save'?'Photo saved. Saving the reading to the station…':uploading?(liveStatus==='error'?'Automatic reading stopped. Saving your photo; no retake is needed to retry the reader.':'Uploading photo and saving its backup. Automatic reading runs separately…'):'Photo saved. Automatic reading in progress. You can photograph the next pump.'} <small>{elapsed} seconds total</small></p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {retryCapture&&!busy&&<button type="button" className="primary" onClick={()=>resumeCapture(retryCapture)}>Retry saving {retryCapture.saved?'reading':'photo'}</button>}
    {retryCapture&&!busy&&detected!==null&&<p role="status">Reading found on this device: <strong>{Number(detected).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3})}</strong>. Waiting to save online.</p>}
    {busy&&liveReading===null&&<small>Clear photos usually finish within 20 seconds. Harder photos get up to 30 seconds; unclear digits require a retake.</small>}
    {photo&&!busy&&!retryCapture&&Number.isFinite(ocrResult?.durationMs)&&<small>Automatic reading: {(ocrResult.durationMs/1000).toFixed(1)} seconds.{Number.isFinite(ocrResult.captureToReadyMs)?` ${Number.isFinite(detected)?'Ready to confirm':'Photo and result saved'}: ${(ocrResult.captureToReadyMs/1000).toFixed(1)} seconds from capture.`:' Photo transfer and server saving are separate.'}</small>}
    {photo&&!busy&&!retryCapture&&!row.readingConfirmed&&detected===null&&ocrResult&&<p className="neutral" role="status">{ocrResult.status==='error'?(ocrResult.reason==='recognition-timeout'?'Automatic reading reached its time limit. The photo is saved. Retry the reader or check the photo and enter the number.':'Automatic reader is unavailable on this attempt. The photo is saved. Retry the reader or check the photo and enter the number.'):ocrResult.status==='pending'?'The previous automatic reading was interrupted. Retry the reader on this saved photo.':'Automatic reader could not verify every digit. Retake a closer photo without reflections.'}</p>}
    {photo&&!busy&&!retryCapture&&!row.readingConfirmed&&(retryReadingCapture||detected===null)&&<button type="button" className="secondary" onClick={retryAutomaticReading}>Retry automatic reading</button>}
    {photo&&!busy&&!retryCapture&&row.readingConfirmed&&!editing?<div className="reading-confirm"><p className="success-box">✓ Reading confirmed and saved: <strong>{Number(row.closing).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3})}</strong></p><button type="button" className="secondary" onClick={editReading}>Edit number</button></div>:photo&&!busy&&!retryCapture&&<div className="reading-confirm">{detected!==null&&!editing&&<p className="reading-check-question"><strong>Are these the right numbers?</strong></p>}{editing?<MeterReadingEditor photo={photo} label={`${row.pump} ${row.nozzle} ${opening?'opening':change?'price-change':'closing'} reading`} value={draft} onChange={setDraft}/>:detected!==null&&<label>Detected reading<input aria-label={`${row.pump} ${row.nozzle} ${opening?'opening':change?'price-change':'closing'} reading`} inputMode="decimal" value={draft} readOnly/></label>}
      {draft!==''&&<p className={warning.level==='NORMAL'?'neutral':'warning-box'}>{!opening&&<>{warning.liters.toLocaleString('en-PH')} {change?'L since opening':'L metered'} · {warning.level}<br/></>}{warning.message}</p>}
      <div className="demo-actions">{(detected!==null||editing)&&<button type="button" className="confirm-button" disabled={!photo||draft===''||warning.blocked} onClick={askToConfirm}>{editing?'Save corrected reading':'Yes, confirm reading'}</button>}{!editing&&<button type="button" className="secondary" onClick={editReading}>{detected===null?'Enter number manually':'Edit number'}</button>}</div>
    </div>}</>}
    {!change&&!opening&&row.readingConfirmed&&<PumpSales report={report} row={row}/>}
    {finalConfirmation&&<ReadingFinalConfirmation reading={finalConfirmation.reading} photo={finalConfirmation.photo} pump={`${row.pump} · ${row.nozzle}`} shift={`${report.date} · ${report.shiftId.replace('shift-','Shift ')}`}
      warning={warning.level!=='NORMAL'?warning.message:''} onCancel={()=>setFinalConfirmation(null)} onConfirm={confirm}/>}
  </article>;
}
function ReaderPreparation(){
  const [status,setStatus]=useState(automaticReaderPreparation);
  useEffect(()=>{
    const unsubscribe=subscribeAutomaticReaderPreparation(setStatus);
    const stop=startAutomaticReaderPreparation();setStatus(automaticReaderPreparation());
    return()=>{unsubscribe();stop();};
  },[]);
  const preparing=status.stage==='primary'||status.stage==='advanced';
  return <aside className="neutral reader-preparation" aria-label="Automatic reader preparation">
    <p role="status">{status.stage==='ready'?'Automatic reader ready. Readings run on this phone.':status.stage==='primary-only'?'Automatic reader ready. Extra checks are unavailable in this browser.':status.stage==='unavailable'?'Automatic reading is unavailable in this browser. Use updated Chrome or Safari.':status.stage==='waiting'?(status.primaryReady?'Automatic reader ready. Extra checks will retry automatically when the connection recovers.':'Reader setup will retry automatically when the connection recovers.'):status.primaryReady?'Automatic reader ready. Preparing extra checks for difficult photos…':'Preparing the automatic reader. You can take a photo while setup continues…'}</p>
    {preparing&&<progress aria-label="Reader preparation progress" max="100" value={status.percent}/>}
  </aside>;
}
export function PumpPhotoWorkflow({report,onReading,onBusy}) {
  const opening=Boolean(report.baselineReport);
  const groups=[...new Set(report.pumpRows.map(r=>r.pump))];const [pump,setPump]=useState(groups[0]);
  const [busyRows,setBusyRows]=useState({});
  const onPumpBusy=useCallback((id,busy,capturing=busy)=>{setBusyRows(previous=>({...previous,[id]:capturing}));onBusy?.(id,busy);},[onBusy]);
  const readingBusy=Object.values(busyRows).some(Boolean);
  const done=report.pumpRows.filter(readingComplete).length;
  const sales=report.pumpRows.filter(readingComplete).map(row=>pumpSalesBreakdown(report,row));
  const total=key=>sales.reduce((sum,row)=>sum+row[key],0);
  return <section className="section"><div className="section-heading"><h2>{opening?'Opening pump readings':'Closing pump readings'}</h2><strong>{done} / {report.pumpRows.length} nozzles complete</strong></div><p>Photograph each {opening?'starting totalizer':'totalizer'}, check the detected number, then confirm. All readings and photos are required to continue.</p>
    {!report.confirmed&&<ReaderPreparation/>}
    {!opening&&done>0&&<div className="pump-sales-summary" aria-label="Confirmed pump sales totals"><p>Metered liters: <b>{total('meteredLiters').toFixed(2)} L</b> · Leak loss: <b>{total('lossLiters').toFixed(2)} L</b></p><p>Total metered sales: <b>{php(total('grossSales'))}</b> · Paid pump sales: <b>{sales.some(row=>row.excessLoss)?'Check leak loss entries':php(total('paidSales'))}</b></p><small>Totals use confirmed pump readings. Tank calibration and other report adjustments are shown in the final report.</small></div>}
    <div className="pump-tabs" role="group" aria-label="Pumps">{groups.map(p=><button key={p} type="button" disabled={readingBusy} className={p===pump?'primary':'secondary'} onClick={()=>setPump(p)}>{p} · {report.pumpRows.filter(r=>r.pump===p&&readingComplete(r)).length}/{report.pumpRows.filter(r=>r.pump===p).length}</button>)}</div>
    {/* Keep cards mounted so changing pumps cannot discard background OCR. */}
    {groups.map(p=><div key={p} className="reading-grid" hidden={p!==pump} style={p!==pump?{display:'none'}:undefined}>{report.pumpRows.filter(r=>r.pump===p).map(row=><PhotoReading key={keyOf(report)+'__'+row.id} row={row} report={report} opening={opening} locked={report.confirmed} onConfirm={onReading} onBusy={onPumpBusy}/>)}</div>)}</section>;
}
export function MidShiftPhotoReadings({report,change,onReading,onBusy,onPrepare}) {
  const rows=report.pumpRows.filter(row=>row.product===change.product);
  const photoRow=row=>midShiftPhotoRow(change,row);
  const [selected,setSelected]=useState(()=>(rows.find(row=>!readingComplete(photoRow(row)))||rows[0])?.id);
  const [capturingRows,setCapturingRows]=useState({});
  const onPhotoBusy=useCallback((id,busy,capturing=busy)=>{setCapturingRows(previous=>({...previous,[id]:capturing}));onBusy?.(change.id+':'+id,busy);},[onBusy,change.id]);
  const capturing=Object.values(capturingRows).some(Boolean);
  const current=rows.find(row=>row.id===selected)||rows[0],index=rows.indexOf(current);
  const done=rows.filter(row=>readingComplete(photoRow(row))).length;
  async function save(next,savedPhoto,options){
    const saved=await onReading(change,next,savedPhoto,options);
    // Move only after a successful confirmation. Keep every card mounted so
    // taking another nozzle's photo cannot interrupt OCR or an upload retry.
    if(next.readingConfirmed&&saved.readingConfirmed){
      const after=rows.findIndex(row=>row.id===next.id);
      const remaining=[...rows.slice(after+1),...rows.slice(0,after)].find(row=>!readingComplete(photoRow(row)));
      if(remaining)setSelected(previous=>previous===next.id?remaining.id:previous);
    }
    return saved;
  }
  return <div className="midshift-photo-readings"><p><strong>{done} / {rows.length} price-change photos confirmed</strong></p><p>Photograph each affected nozzle at the moment the price changes. Check the detected number and confirm it. To use an existing photo, choose the original photo taken at the price-change time.</p>{!report.confirmed&&<ReaderPreparation/>}
    <div className="pump-tabs" role="group" aria-label="Price-change nozzles">{rows.map(row=><button key={row.id} type="button" disabled={capturing} aria-pressed={row.id===current?.id} className={row.id===current?.id?'primary':'secondary'} onClick={()=>setSelected(row.id)}>{row.pump} · {row.nozzle}{readingComplete(photoRow(row))?' · ✓':''}</button>)}</div>
    <p role="status">{done===rows.length?'All price-change readings saved. The manager can now confirm this price change.':`Nozzle ${index+1} of ${rows.length} · ${current?.pump} · ${current?.nozzle}. You can photograph the next nozzle while automatic reading finishes.`}</p>
    {rows.map(row=><div key={change.id+'-'+change.product+'-'+change.effectiveTime+'-'+midShiftPumpKey(row)} hidden={row.id!==current?.id} style={row.id!==current?.id?{display:'none'}:undefined}><PhotoReading row={photoRow(row)} report={report} change={change} onBusy={onPhotoBusy} onPrepare={onPrepare} locked={report.confirmed || !change.effectiveTime} onConfirm={save}/></div>)}
    <div className="demo-actions"><button type="button" className="secondary" disabled={capturing||index<=0} onClick={()=>setSelected(rows[index-1].id)}>Previous nozzle</button><button type="button" className="primary" disabled={capturing||index>=rows.length-1} onClick={()=>setSelected(rows[index+1].id)}>Next nozzle</button></div>
  </div>;
}
export function CashConfirmation({report,onSaved,onCountsChange,onReload,onRefreshVouchers,review=false}) {
  const [counts,setCounts]=useState({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [stale,setStale]=useState(false);
  const denominations=review?counts:(report.cashDenominations||{});
  const reconciliation=review?compute(report):null;
  const blockedVariance=review&&reconciliation?.actualCashCountEntered&&isHighVariance(reconciliation.cashVariance);
  useEffect(()=>{if(!review&&report.cashCountConfirmed){setError('');setStale(false);}},[report.cashCountConfirmed,review]);
  let valid=false;try{denominationTotal(denominations);valid=true;}catch{ /* An empty/invalid count cannot be confirmed. */ }
  async function run(action) {setBusy(true);setError('');setStale(false);try{const r=await demoApi(action,{report,denominations});if(r.report)onSaved(r.report);}catch(e){setError(e.message);setStale(e.status===409||e.saveUncertain===true);}finally{setBusy(false);}}
  async function reload(){setBusy(true);try{await onReload(review?null:denominations);setError('');setStale(false);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="cash-confirmation" aria-busy={busy}>
    {busy&&<p role="status">Waiting for the station server to verify the saved shift…</p>}
    {blockedVariance&&<p className="warning-box" role="alert">{highVarianceMessage(reconciliation.cashVariance)}</p>}
    {!review&&<><CashDenominations counts={denominations} onChange={onCountsChange} disabled={report.cashCountConfirmed||busy} label="End-of-shift cash count"/>{report.cashCountConfirmed?<p>✓ Physical cash confirmed: <strong>{php(report.actualCashCounted)}</strong>{!report.cashDenominations&&' · Earlier count has no denomination breakdown.'}</p>:<button type="button" className="confirm-button" disabled={busy||!valid} onClick={()=>run('cash-confirm')}>Confirm physical cash</button>}</>}
    {review&&<><PendingVouchers report={report} onRefresh={onRefreshVouchers}/><h3>Cash reconciliation</h3>{!report.cashReviewState?<button type="button" data-cash-action className="primary" disabled={busy} onClick={()=>run('cash-check')}>Check my cash count</button>:report.cashReviewState==='recount'||report.cashReviewState==='final'&&blockedVariance?<><p className="warning-box">Please recount your physical cash. Record only the cash actually counted.</p><CashDenominations counts={counts} onChange={setCounts} disabled={busy} label="Final recount"/><button type="button" data-cash-action className="confirm-button" disabled={busy||!valid} onClick={()=>run('cash-recount')}>Confirm final recount</button></>:<p>{report.cashReviewState==='final'?'✓ Final recount recorded. Admin will review the submitted result.':'✓ OK'}</p>}<small>Your count remains saved. If submission is blocked, review the entries and contact your manager if the difference remains.</small></>}
    {error&&<p className="error" role="alert">{error}</p>}
    {stale&&onReload&&<div><p>Reload the saved shift details, then check and confirm again. Your entered cash quantities will be kept; an already confirmed count stays locked.</p><button type="button" className="secondary" disabled={busy} onClick={reload}>{review?'Refresh saved shift':'Refresh shift, keep my cash count'}</button></div>}
  </div>;
}
export function AutomaticPay({report,onSaved}) {
  const [issue,setIssue]=useState('');const [error,setError]=useState('');const [note,setNote]=useState('');
  async function submitIssue(){try{const r=await demoApi('issue',{report,category:'ONLINE_PAY',detail:issue});onSaved(r.report);setIssue('');setNote('Issue sent to Admin for review.');}catch(e){setError(e.message);}}
  return <div className="automatic-pay"><strong>Online Pay · {php(report.onlinePay?.total ?? report.deductions.gcash)}</strong><p>{report.onlinePay?.count??0} transactions · FuelTech Pay · Read only</p><small>Transactions are automatically matched by station, business date and shift.</small><details><summary>Report an issue</summary><label>What looks incorrect?<input value={issue} onChange={e=>setIssue(e.target.value)}/></label><button type="button" disabled={!issue.trim()} onClick={submitIssue}>Send issue to Admin</button></details>{note&&<p>{note}</p>}{error&&<p className="error">{error}</p>}<p className="neutral">POS redemption connection pending the separate app. Existing manual redemption fields remain available.</p></div>;
}
export function DepositUpgrade({branch,role='Manager'}) {
  return role==='Manager'?<ManagerDepositCards key={branch} branch={branch} api={demoApi} HistoryCard={DepositHistoryCard}/>:<DepositSettings branch={branch} role={role}/>;
}
export function DepositSettings({branch,role}) {
  return <AdminDepositCards branch={branch} role={role} api={demoApi} HistoryCard={DepositHistoryCard}/>;
}
export function ErrorAnalytics({reports}) {
  const [filters,setFilters]=useState({station:'',shift:'',cashier:'',manager:'',category:'',status:'',from:'',to:''});const [events,setEvents]=useState([]);
  const all=Object.values(reports).filter(r=>r.confirmed);
  const filtered=all.filter(r=>(!filters.station||r.branch===filters.station)&&(!filters.shift||r.shiftId===filters.shift)&&(!filters.cashier||r.cashierName===filters.cashier)&&(!filters.manager||(r.managerName||'Demo Manager')===filters.manager)&&(!filters.from||r.date>=filters.from)&&(!filters.to||r.date<=filters.to)&&(!filters.category||(r.checkDetails||[]).some(i=>i.category===filters.category))&&(!filters.status||(filters.status==='CHECK REQUIRED')===!!r.checkRequired));
  const flagged=filtered.filter(r=>r.checkRequired).length;
  const select=(name,label,values)=><label>{label}<select value={filters[name]} onChange={e=>setFilters({...filters,[name]:e.target.value})}><option value="">All</option>{values.map(v=><option key={v} value={v}>{name==='category'?reasonLabel(v):v}</option>)}</select></label>;
  const summary=(field)=>[...new Set(filtered.map(r=>r[field]))].map(name=>{const rows=filtered.filter(r=>r[field]===name);const bad=rows.filter(r=>r.checkRequired).length;const counts={};rows.flatMap(r=>r.checkDetails||[]).forEach(i=>{counts[i.category]=(counts[i.category]||0)+1;});return <tr key={name}><td>{name}</td><td>{rows.length}</td><td>{rows.length-bad}</td><td>{bad}</td><td>{((rows.length-bad)/rows.length*100).toFixed(1)}%</td><td>{Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—'}</td></tr>;});
  return <section className="section error-analytics"><h2>Error Analytics</h2><p>Find recurring mistakes by station, shift and staff. Corrected OCR suggestions are audit events; valid corrected readings do not create an error.</p><div className="grid four">{select('station','Station',[...new Set(all.map(r=>r.branch))])}{select('shift','Shift',['shift-1','shift-2','shift-3'])}{select('cashier','Cashier',[...new Set(all.map(r=>r.cashierName))])}{select('manager','Manager',[...new Set(all.map(r=>r.managerName).filter(Boolean))])}{select('category','Category',ERROR_CATEGORIES)}{select('status','Status',['CLEAN','CHECK REQUIRED'])}<label>From<input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label><label>To<input type="date" value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label></div><div className="grid four form-space">{[['Total reports',filtered.length],['Clean reports',filtered.length-flagged],['Check Required',flagged],['Clean rate',filtered.length?`${((filtered.length-flagged)/filtered.length*100).toFixed(1)}%`:'—']].map(([label,value])=><div className="demo-metric" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><div className="category-counts">{ERROR_CATEGORIES.map(c=>{const count=filtered.filter(r=>(r.checkDetails||[]).some(i=>i.category===c)).length;return count?<span key={c}>{c.replaceAll('_',' ')} <b>{count}</b></span>:null;})}</div>{[['Station','branch'],['Cashier','cashierName']].map(([label,field])=><div className="table-wrap" key={field}><h3>{label} errors</h3><table><thead><tr>{[label,'Reports','Clean','Check Required','Clean %','Top category'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{summary(field)}</tbody></table></div>)}<div className="analytics-reasons"><h3>Why these shifts need checking</h3><p>For individual shift review, use Admin → Station Health. You can also inspect the same reasons here.</p>{!flagged&&<p>No check-required shifts match these filters.</p>}{filtered.filter(r=>r.checkRequired).map(r=><details className="health-shift-card" key={keyOf(r)}><summary><strong>{r.branch} · {r.date} · {r.shiftId.replace('shift-','Shift ')}</strong><span className="health-reason-preview">{[...new Set((r.checkDetails||[]).map(i=>reasonLabel(i.category)))].join(' · ')}</span><b>View reasons / entries</b></summary><ShiftReasons report={r}/></details>)}</div><details onToggle={e=>{if(e.currentTarget.open)demoApi('audit').then(r=>setEvents(r.events)).catch(()=>{});}}><summary>Recent audit activity</summary>{events.map(e=><p key={e.id}>{e.at} · {e.role} · {e.action} {e.reportKey||e.depositId||''}</p>)}</details></section>;
}

export function DepositHistoryCard({deposit:d,deposits=[],role,onReviewed}) {
  const [reason,setReason]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function verify(action) {setBusy(true);setError('');try {await demoApi('deposit-verify',{id:d.id,action,reason});await onReviewed?.();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const coverage=depositCoverage(d,deposits);
  return <div>{error&&<p className="error" role="alert">{error}</p>}<article className="deposit-history" key={d.id}><header><strong>{d.branch} · {coverage.title}</strong><b>{d.status.toUpperCase()}{d.partial?' · PARTIAL DEPOSIT':''}</b></header><DepositCoverageLines deposit={d} deposits={deposits}/><p>Bank deposit date: {depositDayLabel(d.depositDate)} · {d.bank}<br/>Manager: {d.manager} · Reference: {d.reference}</p><div className="grid four"><span>Covered cash<br/><b>{php(d.coveredCash)}</b></span><span>Expected deposit<br/><b>{php(d.expected)}</b></span><span>Amount deposited<br/><b>{php(d.amount)}</b></span><span>Unexplained difference<br/><b>{php(d.unexplainedDifference)}</b></span></div>{d.allocationVersion===1?<p>Only the assigned cash is reserved. Unused shift cash remains available for another deposit.</p>:<p>Previous carryover {php(d.previousCarryover)} · Remaining {php(d.carryoverRemaining)}</p>}{d.receiptPath&&<p><a href={d.receiptPath} target="_blank" rel="noreferrer">View bank receipt</a></p>}{d.adjustments.map((a,i)=><p key={i}>{a.type.replaceAll('_',' ')}: {php(a.amount)} {a.note}</p>)}<p className="deposit-difference-help">Record new bank fees and transportation through CV. Earlier deposit expenses, if any, are retained above.</p><details><summary>Covered reports ({coverage.reports.length}){coverage.hasCarryover?' including earlier balance sources':''}</summary>{coverage.reports.map(r=><p key={r.key}>{r.label}{d.reportAllocations?.some(a=>a.reportKey===r.key)?` · ${php(d.reportAllocations.find(a=>a.reportKey===r.key).amount)}`:''}</p>)}{d.carryoverAllocations?.map(a=><p key={a.depositId}>Earlier balance {deposits.find(source=>source.id===a.depositId)?.reference||a.depositId} · {php(a.amount)}</p>)}{(!coverage.reports.length||coverage.incomplete)&&<p>Some covered reports are unavailable.</p>}</details>{d.note&&<p>{d.note}</p>}{d.rejectionReason&&<p className="error">{d.rejectionReason}</p>}{role==='Approver'&&d.status==='pending'&&<div className="demo-actions"><button type="button" className="confirm-button" disabled={busy} onClick={()=>verify('confirm')}>Confirm received</button><select aria-label="Rejection reason" value={reason||''} onChange={e=>setReason(e.target.value)}><option value="">Choose rejection reason</option>{['DEPOSIT NOT FOUND','WRONG AMOUNT','WRONG BANK','WRONG REFERENCE','PARTIAL AMOUNT RECEIVED','OTHER'].map(r=><option key={r}>{r}</option>)}</select><button type="button" className="secondary" disabled={busy||!reason} onClick={()=>verify('reject')}>Reject</button></div>}</article></div>;
}
