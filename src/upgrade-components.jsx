import { pilotPost } from './pilot-client.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { detectTotalizerResult as detect, prepareTotalizer } from './totalizer-ocr.js';
import {readerPreparation,subscribeReaderPreparation,prepareReaderFiles,hasPreparedReaderFiles,canPrepareReaderAutomatically} from './ocr-downloads.js';
import { ERROR_CATEGORIES, denominationTotal, readingComplete, readingWarning } from './error-reduction.ts';
import './upgrade.css';
import { AdminDepositCards } from './admin-deposits.jsx';
import { midShiftPumpKey, midShiftReadingValue } from './mid-shift-price-change.js';
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
export async function demoApi(path,body={}) {
  const value=await pilotPost(`/api/demo/${path}`,body);
  if (['deposit-submit','deposit-verify','settings'].includes(path)) window.dispatchEvent(new Event('fueltech-pilot-change'));
  return value;
}
export async function savePumpReading(report,row) {
  return demoApi('pump-reading',{reportKey:keyOf(report),row,revision:row.readingRevision||0});
}
function PhotoReading({row,report,onConfirm,locked,onBusy,change,onPrepare,opening=false}) {
  const phoneView=usePhoneView();
  const [photo,setPhoto]=useState(row.photo_path||'');const [detected,setDetected]=useState(row.ocr_detected_reading??null);
  const [ocrResult,setOcrResult]=useState(row.ocr_result);
  const [draft,setDraft]=useState(row.readingConfirmed?String(row.closing):row.ocr_detected_reading==null?'':String(row.ocr_detected_reading));const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [uploading,setUploading]=useState(false);
  const [pendingPhoto,setPendingPhoto]=useState('');const [liveReading,setLiveReading]=useState(null);
  const [camera,setCamera]=useState(false);const [openingCamera,setOpeningCamera]=useState(false);const video=useRef(null);const fileInput=useRef(null);const stream=useRef(null);const active=useRef(true);
  const captureInFlight=useRef(false);
  const recognitionRun=useRef(0);
  useEffect(()=>{active.current=true;return()=>{active.current=false;stream.current?.getTracks().forEach(t=>t.stop());};},[]);
  useEffect(()=>{if(!locked)prepareTotalizer().catch(()=>{});},[locked]);
  useEffect(()=>{if(camera&&video.current)video.current.srcObject=stream.current;},[camera]);
  const revision=useRef(row.readingRevision||0);
  useEffect(()=>{onBusy?.(row.id,busy||camera||openingCamera,uploading||camera||openingCamera);return()=>onBusy?.(row.id,false,false);},[busy,uploading,camera,openingCamera,onBusy,row.id]);
  useEffect(()=>{
    if(busy || Number(row.readingRevision||0)===revision.current)return;
    revision.current=Number(row.readingRevision||0);setPhoto(row.photo_path||'');setDetected(row.ocr_detected_reading??null);setOcrResult(row.ocr_result);setDraft(row.readingConfirmed?String(row.closing):row.ocr_detected_reading==null?'':String(row.ocr_detected_reading));setEditing(false);
  },[row,busy]);
  async function saveReading(next,savedPhoto) {
    // Photo upload already committed this report. Reuse that response to show
    // the saved evidence without another mutation or waiting for recognition.
    const saved=await onConfirm({...next,readingRevision:revision.current},savedPhoto);
    revision.current=Number(saved.readingRevision||0);
    return saved;
  }
  const warning=opening
    ? {level:'NORMAL',liters:0,blocked:draft===''||!Number.isFinite(Number(draft))||Number(draft)<0||Number(draft)>1e12,message:'This confirmed number becomes the starting pump reading.'}
    : readingWarning({...row,closing:draft});
  if(change && row.finalClosing!=='' && row.finalClosing!=null && Number(draft)>Number(row.finalClosing)) {warning.blocked=true;warning.message='Price-change reading cannot exceed the confirmed shift closing.';}
  async function processPhoto(data,recognitionImage=data) {
    const run=++recognitionRun.current;
    setBusy(true);setUploading(true);setError('');setDraft('');setDetected(null);setOcrResult(undefined);setEditing(false);
    setPendingPhoto(data);setLiveReading(null);
    try {
      if(data.length>2800000) throw Error('Photo is too large. Move closer and take another photo.');
      // Recognize locally while the photo uploads, instead of waiting through
      // several server round trips before starting the OCR worker.
      const recognition=detect(recognitionImage);
      recognition.then(({reading})=>{
        if(active.current&&recognitionRun.current===run)setLiveReading(Number.isFinite(reading)?reading:null);
      },()=>{});
      await onPrepare?.();
      const saved=await demoApi('photo',{reportKey:keyOf(report),rowId:row.id,data,replaceReading:true,revision:revision.current,...(change?{changeId:change.id,pumpKey:midShiftPumpKey(row)}: {})});
      if(!active.current)return;setPhoto(saved.photo_path);
      // Photo upload atomically invalidates the old confirmation. Persist the
      // suggestion in one reading save, using the revision returned by upload.
      revision.current=Number(saved.readingRevision);
      const uploadedRow={...row,photo_path:saved.photo_path,readingConfirmed:false,closingEntered:false,closing:'',ocr_detected_reading:null};
      await saveReading(uploadedRow,saved);
      if(!active.current)return;
      setUploading(false);
      const {reading:value,attempt}=await recognition;
      if(!active.current)return;setDetected(value);setOcrResult(attempt);setDraft(value===null?'':String(value));
      await saveReading({...row,photo_path:saved.photo_path,readingConfirmed:false,closingEntered:false,closing:'',ocr_detected_reading:value,ocr_result:attempt});
      if(value===null)setEditing(false);
    } catch(e) {setError(e.message);}finally{if(active.current&&recognitionRun.current===run){recognitionRun.current++;setBusy(false);setUploading(false);setPendingPhoto('');setLiveReading(null);}}
  }
  async function openCamera() {
    setError('');
    if(!navigator.mediaDevices?.getUserMedia){
      if(phoneView)setError('Live camera is unavailable. Open this page in your phone browser and allow camera access.');
      else fileInput.current?.click();
      return;
    }
    setOpeningCamera(true);
    try {
      const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if(!active.current){opened.getTracks().forEach(t=>t.stop());return;}
      stream.current=opened;setCamera(true);
    }catch{if(active.current)setError(phoneView?'Camera access is unavailable. Allow camera access in your phone browser settings, then tap Open camera again.':'Camera access is unavailable. Use the photo picker below.');}
    finally{if(active.current)setOpeningCamera(false);}
  }
  async function capture() {
    const v=video.current;if(!v?.videoWidth||captureInFlight.current)return;
    captureInFlight.current=true;setBusy(true);setUploading(true);
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
      stream.current?.getTracks().forEach(t=>t.stop());setCamera(false);await processPhoto(data,recognitionImage);
    }catch{if(active.current)setError('The camera frame was not ready. Please capture the photo again.');}
    finally{captureInFlight.current=false;if(active.current){setBusy(false);setUploading(false);}}
  }
  async function selectPhoto(event) {
    if(phoneView)return;
    const file=event.target.files?.[0];if(!file)return;
    try {
      const bitmap=await createImageBitmap(file);const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();await processPhoto(canvas.toDataURL('image/jpeg',.92));
    }catch{setError('This image could not be opened. Please take another photo.');}
  }
  async function confirm() {
    if(!photo||draft===''||warning.blocked)return;
    if(warning.level!=='NORMAL'&&!window.confirm(`${warning.message}\nConfirm this reading only after checking the pump. Admin will see the warning.`))return;
    setBusy(true);setError('');
    try {await saveReading({...row,closing:Number(draft),closingEntered:true,closingEntrySource:'cashier',photo_path:photo,ocr_detected_reading:detected,ocr_result:ocrResult,ocr_was_edited:detected!==null&&Number(draft)!==detected,readingConfirmed:true,confirmed_closing_reading:Number(draft),calculated_liters:warning.liters,reading_warning:warning.level});
    setEditing(false);
    } catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function editReading() {
    setBusy(true);setError('');try{await saveReading({...row,readingConfirmed:false});setEditing(true);}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <article className={`reading-card ${readingComplete(row)?'complete':''}`} data-pump-row-id={row.id}>
    <header><div><strong>{change?`${row.pump} · ${row.nozzle}`:row.nozzle}</strong><small>{opening?`${row.product} · Starting totalizer reading`:<>{row.product} · Opening {Number(row.opening).toLocaleString('en-PH',{minimumFractionDigits:2})} 🔒</>}</small></div><b>{readingComplete(row)?'✓ Complete':'Photo required'}</b></header>
    {(pendingPhoto||photo)&&<img src={pendingPhoto||photo} alt={`${row.pump} ${row.nozzle} totalizer`} className="totalizer-photo"/>}
    {photo&&row.readingConfirmed&&locked&&<p className="success-box">✓ Reading confirmed and saved: <strong>{Number(row.closing).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3})}</strong></p>}
    {camera&&<div><p>Fill the guide with all eight digits and the decimal point. Move closer and tilt the phone until reflections leave the digits.</p><div className="totalizer-camera"><video ref={video} autoPlay playsInline muted/><div className="totalizer-camera-guide" aria-hidden="true"/></div><button type="button" onClick={capture}>Capture photo</button><button type="button" onClick={()=>{stream.current?.getTracks().forEach(t=>t.stop());setCamera(false);}}>Cancel camera</button></div>}
    {!locked&&<><div className="demo-actions"><button type="button" className="primary" disabled={busy||camera||openingCamera} onClick={openCamera}>{openingCamera?'Opening camera…':photo?'Retake photo':'Open camera'}</button>{!phoneView&&<label className="photo-picker">Take / choose photo<input ref={fileInput} type="file" accept="image/*" onChange={selectPhoto} disabled={busy}/></label>}</div>
    {busy&&<p role="status">{liveReading!==null?<>Reading found: <strong>{Number(liveReading).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3})}</strong>. Saving photo and reading…</>:uploading?'Saving photo or reading…':'Photo saved. Automatic reading in progress. You can photograph the next pump.'}</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {photo&&!busy&&!row.readingConfirmed&&detected===null&&ocrResult&&<p className="neutral" role="status">{ocrResult.status==='error'?'Automatic reader failed to load. The photo is saved. Reconnect and retake to retry.':ocrResult.status==='pending'?'The automatic reading did not finish. Retake the photo to try again.':'Automatic reader could not verify every digit. Retake a closer photo without reflections.'}</p>}
    {photo&&!busy&&row.readingConfirmed&&!editing?<div className="reading-confirm"><p className="success-box">✓ Reading confirmed and saved: <strong>{Number(row.closing).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3})}</strong></p><button type="button" className="secondary" onClick={editReading}>Edit number</button></div>:photo&&!busy&&<div className="reading-confirm">{detected===null&&editing&&<p className="neutral">Check every digit in the saved photo before entering a number. Retake if any digit is covered or unclear.</p>}{(detected!==null||editing)&&<label>{detected===null?'Reading shown in photo':editing?'Correct detected reading':'Detected reading'}<input aria-label={`${row.pump} ${row.nozzle} ${opening?'opening':change?'price-change':'closing'} reading`} inputMode="decimal" value={draft} readOnly={!editing} onChange={e=>setDraft(e.target.value)}/></label>}
      {draft!==''&&<p className={warning.level==='NORMAL'?'neutral':'warning-box'}>{!opening&&<>{warning.liters.toLocaleString('en-PH')} {change?'L since opening':'L metered'} · {warning.level}<br/></>}{warning.message}</p>}
      <div className="demo-actions">{(detected!==null||editing)&&<button type="button" className="confirm-button" disabled={!photo||draft===''||warning.blocked} onClick={confirm}>Yes, confirm reading</button>}<button type="button" className="secondary" onClick={editReading}>{detected===null&&!editing?'Enter number manually':'Edit number'}</button></div>
    </div>}</>}
    {!change&&!opening&&row.readingConfirmed&&<PumpSales report={report} row={row}/>}
  </article>;
}
function ReaderPreparation(){
  const [status,setStatus]=useState(readerPreparation);const [primaryReady,setPrimaryReady]=useState(false);
  const [preparingPrimary,setPreparingPrimary]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{
    let mounted=true,timer;const unsubscribe=subscribeReaderPreparation(setStatus);
    prepareTotalizer().then(async()=>{
      if(!mounted)return;setPrimaryReady(true);
      if(await hasPreparedReaderFiles())return prepareReaderFiles();
      if(mounted&&canPrepareReaderAutomatically())timer=window.setTimeout(()=>{prepareReaderFiles().catch(()=>{});},1500);
    }).catch(()=>{});
    return()=>{mounted=false;window.clearTimeout(timer);unsubscribe();};
  },[]);
  const ready=primaryReady&&status.status==='ready',preparing=preparingPrimary||status.status==='preparing';
  async function prepare(){
    setPreparingPrimary(true);setError('');
    try{await Promise.all([prepareTotalizer().then(()=>setPrimaryReady(true)),prepareReaderFiles()]);}
    catch{setError('Preparation could not finish. Check your connection and retry.');}
    finally{setPreparingPrimary(false);}
  }
  return <aside className="neutral reader-preparation" aria-label="Automatic reader preparation">
    {ready?<p role="status">{status.savedForReuse?'Reader ready for faster photos.':'Reader ready for this page. Keep it open for faster photos.'}</p>:<>
      <p>Prepare the reader on Wi-Fi once for faster readings when the signal is weak. Photos still need a connection to save.</p>
      <button type="button" className="secondary" disabled={preparing} onClick={prepare}>{preparing?'Preparing reader…':'Prepare faster readings'}</button>
      {preparing&&<p role="status">Preparing reader: {status.percent}% <progress aria-label="Reader preparation progress" max="100" value={status.percent}/></p>}
      {(error||status.status==='error')&&<p role="status">{error||'Preparation could not finish. Check your connection and retry.'}</p>}
    </>}
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
  const photoRow=row=>{
    const evidence=change.readingPhotos?.[midShiftPumpKey(row)]||{};
    return {...row,...evidence,closing:midShiftReadingValue(change,row),photo_path:evidence.photo_path||'',readingConfirmed:!!evidence.readingConfirmed,closingEntered:!!evidence.readingConfirmed,readingRevision:evidence.readingRevision||0,finalClosing:row.closingEntered?row.closing:''};
  };
  const done=rows.filter(row=>readingComplete(photoRow(row))).length;
  return <div className="midshift-photo-readings"><p><strong>{done} / {rows.length} price-change photos confirmed</strong></p><p>Photograph each affected nozzle at the moment the price changes. Check the detected number and confirm it.</p>{!report.confirmed&&<ReaderPreparation/>}<div className="reading-grid">{rows.map(row=><PhotoReading key={change.id+'-'+change.product+'-'+change.effectiveTime+'-'+midShiftPumpKey(row)} row={photoRow(row)} report={report} change={change} onBusy={onBusy} onPrepare={onPrepare} locked={report.confirmed || !change.effectiveTime} onConfirm={(next,savedPhoto)=>onReading(change,next,savedPhoto)}/>)}</div></div>;
}
export function CashConfirmation({report,onSaved,onCountsChange,onReload,review=false}) {
  const [counts,setCounts]=useState({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [stale,setStale]=useState(false);
  const denominations=review?counts:(report.cashDenominations||{});
  const reconciliation=review?compute(report):null;
  const unusuallySmall=report.branch==='Liloan'&&reconciliation?.actualCashCountEntered&&reconciliation.expectedCash>1500&&reconciliation.actualCashCounted<reconciliation.expectedCash*.1;
  useEffect(()=>{if(!review&&report.cashCountConfirmed){setError('');setStale(false);}},[report.cashCountConfirmed,review]);
  let valid=false;try{denominationTotal(denominations);valid=true;}catch{ /* An empty/invalid count cannot be confirmed. */ }
  async function run(action) {setBusy(true);setError('');setStale(false);try{const r=await demoApi(action,{report,denominations});if(r.report)onSaved(r.report);}catch(e){setError(e.message);setStale(e.status===409||e.saveUncertain===true);}finally{setBusy(false);}}
  async function reload(){setBusy(true);try{await onReload(review?null:denominations);setError('');setStale(false);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="cash-confirmation" aria-busy={busy}>
    {busy&&<p role="status">Waiting for the station server to verify the saved shift…</p>}
    {unusuallySmall&&<p className="warning-box" role="alert">Physical cash recorded: <strong>{php(reconciliation.actualCashCounted)}</strong>. Expected cash: <strong>{php(reconciliation.expectedCash)}</strong>. Check that all notes and coins were included, including cash set aside for deposit. Recount the actual cash; do not change it just to match the expected amount.</p>}
    {!review&&<><CashDenominations counts={denominations} onChange={onCountsChange} disabled={report.cashCountConfirmed||busy} label="End-of-shift cash count"/>{report.cashCountConfirmed?<p>✓ Physical cash confirmed: <strong>{php(report.actualCashCounted)}</strong>{!report.cashDenominations&&' · Earlier count has no denomination breakdown.'}</p>:<button type="button" className="confirm-button" disabled={busy||!valid} onClick={()=>run('cash-confirm')}>Confirm physical cash</button>}</>}
    {review&&<><h3>Cash reconciliation</h3>{!report.cashReviewState?<button type="button" className="primary" disabled={busy} onClick={()=>run('cash-check')}>Check my cash count</button>:report.cashReviewState==='recount'?<><p className="warning-box">Please recount your physical cash.</p><CashDenominations counts={counts} onChange={setCounts} disabled={busy} label="Final recount"/><button type="button" className="confirm-button" disabled={busy||!valid} onClick={()=>run('cash-recount')}>Confirm final recount</button></>:<p>{report.cashReviewState==='final'?'✓ Final recount recorded. Admin will review the submitted result.':'✓ OK'}</p>}<small>Your confirmed count is locked. A requested recount can be confirmed once.</small></>}
    {error&&<p className="error" role="alert">{error}</p>}
    {stale&&onReload&&<div><p>Reload the saved shift details, then check and confirm again. Your entered cash quantities will be kept; an already confirmed count stays locked.</p><button type="button" className="secondary" disabled={busy} onClick={reload}>{review?'Refresh saved shift':'Refresh shift, keep my cash count'}</button></div>}
  </div>;
}
export function AutomaticPay({report,onSaved}) {
  const [issue,setIssue]=useState('');const [error,setError]=useState('');const [note,setNote]=useState('');
  async function submitIssue(){try{const r=await demoApi('issue',{report,category:'ONLINE_PAY',detail:issue});onSaved(r.report);setIssue('');setNote('Issue sent to Admin for review.');}catch(e){setError(e.message);}}
  return <div className="automatic-pay"><strong>Online Pay · {php(report.onlinePay?.total ?? report.deductions.gcash)}</strong><p>{report.onlinePay?.count??0} transactions · FuelTech Pay · Read only</p><small>Transactions are automatically matched by station, business date and shift.</small><details><summary>Report an issue</summary><label>What looks incorrect?<input value={issue} onChange={e=>setIssue(e.target.value)}/></label><button type="button" disabled={!issue.trim()} onClick={submitIssue}>Send issue to Admin</button></details>{note&&<p>{note}</p>}{error&&<p className="error">{error}</p>}<p className="neutral">POS redemption connection pending the separate app. Existing manual redemption fields remain available.</p></div>;
}
export function TankDeliveries({report,patchReport}) {
  const [draft,setDraft]=useState({product:'Diesel',liters:'',time:'',reference:''});const [error,setError]=useState('');
  function add(){setError('');if(!(Number(draft.liters)>0)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)||!draft.reference.trim()){setError('Enter product, liters, delivery time and reference.');return;}const rows=report.deliveries||[];if(rows.some(r=>r.product===draft.product&&r.reference.trim().toLowerCase()===draft.reference.trim().toLowerCase())){setError('This delivery reference is already recorded for this product.');return;}patchReport(['root','deliveries'],[...rows,{...draft,id:crypto.randomUUID(),liters:Number(draft.liters)}]);setDraft({...draft,liters:'',reference:''});}
  return <div className="delivery-section"><h3>Tank deliveries</h3><div className="grid four"><label>Product<select value={draft.product} onChange={e=>setDraft({...draft,product:e.target.value})}>{['Premium','Regular','Diesel'].map(p=><option key={p}>{p}</option>)}</select></label><label>Delivered liters<input inputMode="decimal" value={draft.liters} onChange={e=>setDraft({...draft,liters:e.target.value})}/></label><label>Time<input type="text" placeholder="HH:mm" inputMode="text" value={draft.time} onChange={e=>setDraft(old=>({...old,time:e.target.value}))}/></label><label>Reference<input value={draft.reference} onChange={e=>setDraft({...draft,reference:e.target.value})}/></label></div><button type="button" className="secondary" onClick={add}>Confirm delivery</button>{error&&<p className="error">{error}</p>}{(report.deliveries||[]).map(d=><p key={d.id}>{d.product} · {d.liters.toLocaleString()} L · {d.time} · {d.reference}</p>)}</div>;
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
  return <div>{error&&<p className="error" role="alert">{error}</p>}<article className="deposit-history" key={d.id}><header><strong>{d.branch} · {coverage.title}</strong><b>{d.status.toUpperCase()}{d.partial?' · PARTIAL DEPOSIT':''}</b></header><DepositCoverageLines deposit={d} deposits={deposits}/><p>Bank deposit date: {depositDayLabel(d.depositDate)} · {d.bank}<br/>Manager: {d.manager} · Reference: {d.reference}</p><div className="grid four"><span>Covered cash<br/><b>{php(d.coveredCash)}</b></span><span>Expected deposit after expenses<br/><b>{php(d.expected)}</b></span><span>Amount deposited<br/><b>{php(d.amount)}</b></span><span>Unexplained difference<br/><b>{php(d.unexplainedDifference)}</b></span></div><p>Previous carryover {php(d.previousCarryover)} · Remaining {php(d.carryoverRemaining)}</p>{d.adjustments.map((a,i)=><p key={i}>{a.type.replaceAll('_',' ')}: {php(a.amount)} {a.note}</p>)}<p className="deposit-difference-help">Bank fees and transportation are recorded as expenses. Unexplained difference is any amount still unmatched after those expenses.</p><details><summary>Covered reports ({coverage.reports.length}){coverage.hasCarryover?' including earlier balance sources':''}</summary>{coverage.reports.map(r=><p key={r.key}>{r.label}</p>)}{(!coverage.reports.length||coverage.incomplete)&&<p>Some covered reports are unavailable.</p>}</details>{d.note&&<p>{d.note}</p>}{d.rejectionReason&&<p className="error">{d.rejectionReason}</p>}{role==='Approver'&&d.status==='pending'&&<div className="demo-actions"><button type="button" className="confirm-button" disabled={busy} onClick={()=>verify('confirm')}>Confirm received</button><select aria-label="Rejection reason" value={reason||''} onChange={e=>setReason(e.target.value)}><option value="">Choose rejection reason</option>{['DEPOSIT NOT FOUND','WRONG AMOUNT','WRONG BANK','WRONG REFERENCE','PARTIAL AMOUNT RECEIVED','OTHER'].map(r=><option key={r}>{r}</option>)}</select><button type="button" className="secondary" disabled={busy||!reason} onClick={()=>verify('reject')}>Reject</button></div>}</article></div>;
}
