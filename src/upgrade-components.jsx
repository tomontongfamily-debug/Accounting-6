import { pilotPost } from './pilot-client.js';
import { useEffect, useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';
import { ERROR_CATEGORIES, denominationTotal, parseOcrReading, readingComplete, readingWarning } from './error-reduction.ts';
import './upgrade.css';
import { AdminDepositCards } from './admin-deposits.jsx';
import { midShiftPumpKey, midShiftReadingValue } from './mid-shift-price-change.js';
import { CashDenominations } from './cash-denominations.jsx';
import { ShiftReasons, reasonLabel } from './shift-health.jsx';
import { ManagerDepositCards } from './deposit-cards.jsx';
const php=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
const keyOf=r=>`${r.branch}__${r.date}__${r.shiftId}`;
export async function demoApi(path,body={}) {
  const value=await pilotPost(`/api/demo/${path}`,body);
  if (['deposit-submit','deposit-verify','settings'].includes(path)) window.dispatchEvent(new Event('fueltech-pilot-change'));
  return value;
}
export async function savePumpReading(report,row) {
  return demoApi('pump-reading',{reportKey:keyOf(report),row,revision:row.readingRevision||0});
}
let workerPromise;
async function detect(data) {
  workerPromise ||= createWorker('eng',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core',langPath:'/ocr/lang',workerBlobURL:false});
  let worker;
  try {
    worker=await workerPromise;
    await worker.setParameters({tessedit_char_whitelist:'0123456789.,',tessedit_pageseg_mode:'7'});
    const result=await worker.recognize(data);
    return parseOcrReading(result.data.text);
  } catch(error) {workerPromise=undefined;if(worker) await worker.terminate();throw error;}
}
function PhotoReading({row,report,onConfirm,locked,onBusy,change,onPrepare}) {
  const [photo,setPhoto]=useState(row.photo_path||'');const [detected,setDetected]=useState(row.ocr_detected_reading??null);
  const [draft,setDraft]=useState(row.readingConfirmed?String(row.closing):'');const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [attempts,setAttempts]=useState(0);
  const [camera,setCamera]=useState(false);const video=useRef(null);const fileInput=useRef(null);const stream=useRef(null);const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;stream.current?.getTracks().forEach(t=>t.stop());};},[]);
  useEffect(()=>{if(camera&&video.current)video.current.srcObject=stream.current;},[camera]);
  const revision=useRef(row.readingRevision||0);
  useEffect(()=>{onBusy?.(row.id,busy);return()=>onBusy?.(row.id,false);},[busy,onBusy,row.id]);
  useEffect(()=>{
    if(busy || Number(row.readingRevision||0)===revision.current)return;
    revision.current=Number(row.readingRevision||0);setPhoto(row.photo_path||'');setDetected(row.ocr_detected_reading??null);setDraft(row.readingConfirmed?String(row.closing):'');setEditing(false);
  },[row,busy]);
  async function saveReading(next) {
    const saved=await onConfirm({...next,readingRevision:revision.current});
    revision.current=Number(saved.readingRevision||0);
    return saved;
  }
  const warning=readingWarning({...row,closing:draft});
  if(change && row.finalClosing!=='' && row.finalClosing!=null && Number(draft)>Number(row.finalClosing)) {warning.blocked=true;warning.message='Price-change reading cannot exceed the confirmed shift closing.';}
  async function processPhoto(data) {
    setBusy(true);setError('');setDraft('');setDetected(null);setEditing(false);setAttempts(n=>n+1);
    try {
      if(data.length>2800000) throw Error('Photo is too large. Move closer and take another photo.');
      await onPrepare?.();
      const saved=await demoApi('photo',{reportKey:keyOf(report),rowId:row.id,data,...(change?{changeId:change.id,pumpKey:midShiftPumpKey(row)}: {})});
      if(!active.current)return;setPhoto(saved.photo_path);
      // Invalidate an earlier confirmation as soon as a replacement is captured.
      await saveReading({...row,photo_path:saved.photo_path,readingConfirmed:false,closingEntered:false,closing:'',ocr_detected_reading:null});
      let value=null;
      try {value=await detect(data);}catch {setError('OCR is unavailable. Retake, or enter the reading while keeping the photo.');setEditing(true);}
      if(!active.current)return;setDetected(value);setDraft(value===null?'':String(value));
      if(value===null)setError("We couldn't read one clear number. Retake a close photo of just the totalizer.");
    } catch(e) {setError(e.message);}finally{if(active.current)setBusy(false);}
  }
  async function openCamera() {
    setError('');if(!navigator.mediaDevices?.getUserMedia){fileInput.current?.click();return;}try {stream.current=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});setCamera(true);}catch{setError('Camera access is unavailable. Use the photo picker below.');}
  }
  function capture() {
    const canvas=document.createElement('canvas');const v=video.current;if(!v?.videoWidth)return;
    const scale=Math.min(1,1800/Math.max(v.videoWidth,v.videoHeight));canvas.width=v.videoWidth*scale;canvas.height=v.videoHeight*scale;canvas.getContext('2d').drawImage(v,0,0,canvas.width,canvas.height);
    stream.current?.getTracks().forEach(t=>t.stop());setCamera(false);processPhoto(canvas.toDataURL('image/jpeg',.9));
  }
  async function selectPhoto(event) {
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
    try {await saveReading({...row,closing:Number(draft),closingEntered:true,closingEntrySource:'cashier',photo_path:photo,ocr_detected_reading:detected,ocr_was_edited:detected!==null&&Number(draft)!==detected,readingConfirmed:true,confirmed_closing_reading:Number(draft),calculated_liters:warning.liters,reading_warning:warning.level});
    setEditing(false);
    } catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function editReading() {
    setBusy(true);setError('');try{await saveReading({...row,readingConfirmed:false});setEditing(true);}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <article className={`reading-card ${readingComplete(row)?'complete':''}`} data-pump-row-id={row.id}>
    <header><div><strong>{change?`${row.pump} · ${row.nozzle}`:row.nozzle}</strong><small>{row.product} · Opening {Number(row.opening).toLocaleString('en-PH',{minimumFractionDigits:2})} 🔒</small></div><b>{readingComplete(row)?'✓ Complete':'Photo required'}</b></header>
    {photo&&<img src={photo} alt={`${row.pump} ${row.nozzle} totalizer`} className="totalizer-photo"/>}
    {camera&&<div><video ref={video} autoPlay playsInline muted/><button type="button" onClick={capture}>Capture photo</button><button type="button" onClick={()=>{stream.current?.getTracks().forEach(t=>t.stop());setCamera(false);}}>Cancel camera</button></div>}
    {!locked&&<><div className="demo-actions"><button type="button" className="primary" disabled={busy} onClick={openCamera}>{photo?'Retake photo':'Open camera'}</button><label className="photo-picker">Take / choose photo<input ref={fileInput} type="file" accept="image/*" onChange={selectPhoto} disabled={busy}/></label></div>
    {busy&&<p role="status">Saving photo or reading…</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {photo&&!busy&&<div className="reading-confirm"><label>{editing?'Correct detected reading':'Detected reading'}<input aria-label={`${row.pump} ${row.nozzle} ${change?'price-change':'closing'} reading`} inputMode="decimal" value={draft} readOnly={!editing} onChange={e=>setDraft(e.target.value)}/></label>
      {draft!==''&&<p className={warning.level==='NORMAL'?'neutral':'warning-box'}>{warning.liters.toLocaleString('en-PH')} {change?'L since opening':'L sold'} · {warning.level}<br/>{warning.message}</p>}
      <div className="demo-actions"><button type="button" className="confirm-button" disabled={!photo||draft===''||warning.blocked} onClick={confirm}>Yes, confirm reading</button><button type="button" className="secondary" disabled={detected===null&&attempts<2&&!editing} onClick={editReading}>Edit number</button></div>
      {detected===null&&attempts<2&&!editing&&<small>Retake once more; manual input becomes available if OCR still cannot read it.</small>}
    </div>}</>}
  </article>;
}
export function PumpPhotoWorkflow({report,onReading,onBusy}) {
  const groups=[...new Set(report.pumpRows.map(r=>r.pump))];const [pump,setPump]=useState(groups[0]);
  const done=report.pumpRows.filter(readingComplete).length;
  return <section className="section"><div className="section-heading"><h2>Closing pump readings</h2><strong>{done} / {report.pumpRows.length} nozzles complete</strong></div><p>Photograph each totalizer, check the detected number, then confirm. All readings and photos are required to continue.</p><div className="pump-tabs" role="group" aria-label="Pumps">{groups.map(p=><button key={p} type="button" className={p===pump?'primary':'secondary'} onClick={()=>setPump(p)}>{p} · {report.pumpRows.filter(r=>r.pump===p&&readingComplete(r)).length}/{report.pumpRows.filter(r=>r.pump===p).length}</button>)}</div><div className="reading-grid">{report.pumpRows.filter(r=>r.pump===pump).map(row=><PhotoReading key={row.id} row={row} report={report} locked={report.confirmed} onConfirm={onReading} onBusy={onBusy}/>)}</div></section>;
}
export function MidShiftPhotoReadings({report,change,onReading,onBusy,onPrepare}) {
  const rows=report.pumpRows.filter(row=>row.product===change.product);
  const photoRow=row=>{
    const evidence=change.readingPhotos?.[midShiftPumpKey(row)]||{};
    return {...row,...evidence,closing:midShiftReadingValue(change,row),photo_path:evidence.photo_path||'',readingConfirmed:!!evidence.readingConfirmed,closingEntered:!!evidence.readingConfirmed,readingRevision:evidence.readingRevision||0,finalClosing:row.closingEntered?row.closing:''};
  };
  const done=rows.filter(row=>readingComplete(photoRow(row))).length;
  return <div className="midshift-photo-readings"><p><strong>{done} / {rows.length} price-change photos confirmed</strong></p><p>Photograph each affected nozzle at the moment the price changes. Check the detected number and confirm it.</p><div className="reading-grid">{rows.map(row=><PhotoReading key={change.id+'-'+change.product+'-'+change.effectiveTime+'-'+midShiftPumpKey(row)} row={photoRow(row)} report={report} change={change} onBusy={onBusy} onPrepare={onPrepare} locked={report.confirmed || !change.effectiveTime} onConfirm={next=>onReading(change,next)}/>)}</div></div>;
}
export function CashConfirmation({report,onSaved,onCountsChange,review=false}) {
  const [counts,setCounts]=useState({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const denominations=review?counts:(report.cashDenominations||{});
  let valid=false;try{denominationTotal(denominations);valid=true;}catch{ /* An empty/invalid count cannot be confirmed. */ }
  async function run(action) {setBusy(true);setError('');try{const r=await demoApi(action,{report,denominations});if(r.report)onSaved(r.report);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="cash-confirmation">
    {!review&&<><CashDenominations counts={denominations} onChange={onCountsChange} disabled={report.cashCountConfirmed||busy} label="End-of-shift cash count"/>{report.cashCountConfirmed?<p>✓ Physical cash confirmed: <strong>{php(report.actualCashCounted)}</strong>{!report.cashDenominations&&' · Earlier count has no denomination breakdown.'}</p>:<button type="button" className="confirm-button" disabled={busy||!valid} onClick={()=>run('cash-confirm')}>Confirm physical cash</button>}</>}
    {review&&<><h3>Cash reconciliation</h3>{!report.cashReviewState?<button type="button" className="primary" disabled={busy} onClick={()=>run('cash-check')}>Check my cash count</button>:report.cashReviewState==='recount'?<><p className="warning-box">Please recount your physical cash.</p><CashDenominations counts={counts} onChange={setCounts} disabled={busy} label="Final recount"/><button type="button" className="confirm-button" disabled={busy||!valid} onClick={()=>run('cash-recount')}>Confirm final recount</button></>:<p>{report.cashReviewState==='final'?'✓ Final recount recorded. Admin will review the submitted result.':'✓ OK'}</p>}<small>Your confirmed count is locked. A requested recount can be confirmed once.</small></>}
    {error&&<p className="error" role="alert">{error}</p>}
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

export function DepositHistoryCard({deposit:d,role,onReviewed}) {
  const [reason,setReason]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function verify(action) {setBusy(true);setError('');try {await demoApi('deposit-verify',{id:d.id,action,reason});await onReviewed?.();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div>{error&&<p className="error" role="alert">{error}</p>}<article className="deposit-history" key={d.id}><header><strong>{d.branch} · {d.depositDate} · {d.bank}</strong><b>{d.status.toUpperCase()}{d.partial?' · PARTIAL DEPOSIT':''}</b></header><p>Manager: {d.manager} · Reference: {d.reference}</p><div className="grid four"><span>Covered cash<br/><b>{php(d.coveredCash)}</b></span><span>Expected<br/><b>{php(d.expected)}</b></span><span>Actual<br/><b>{php(d.amount)}</b></span><span>Unexplained difference<br/><b>{php(d.unexplainedDifference)}</b></span></div><p>Previous carryover {php(d.previousCarryover)} · Remaining {php(d.carryoverRemaining)}</p>{d.adjustments.map((a,i)=><p key={i}>{a.type.replaceAll('_',' ')}: {php(a.amount)} {a.note}</p>)}<details><summary>Covered reports ({d.coveredReportKeys.length})</summary>{d.coveredReportKeys.map(k=><p key={k}>{k.replaceAll('__',' · ')}</p>)}</details>{d.note&&<p>{d.note}</p>}{d.rejectionReason&&<p className="error">{d.rejectionReason}</p>}{role==='Approver'&&d.status==='pending'&&<div className="demo-actions"><button type="button" className="confirm-button" disabled={busy} onClick={()=>verify('confirm')}>Confirm received</button><select aria-label="Rejection reason" value={reason||''} onChange={e=>setReason(e.target.value)}><option value="">Choose rejection reason</option>{['DEPOSIT NOT FOUND','WRONG AMOUNT','WRONG BANK','WRONG REFERENCE','PARTIAL AMOUNT RECEIVED','OTHER'].map(r=><option key={r}>{r}</option>)}</select><button type="button" className="secondary" disabled={busy||!reason} onClick={()=>verify('reject')}>Reject</button></div>}</article></div>;
}
