import {useEffect,useRef,useState} from 'react';
import {pilotPost} from './pilot-client.js';
import {temporaryManualPriceOpen} from './temporary-price-reading.js';

function ManualPriceReview({reading,report,change,row,busy,error,onCancel,onConfirm}){
  const dialog=useRef(null);
  useEffect(()=>{const element=dialog.current;element.showModal();return()=>{if(element.open)element.close();};},[]);
  return <dialog ref={dialog} className="reading-final-confirmation" aria-label="Confirm manual price-change reading" onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>
    <h2>Confirm manual price-change reading</h2>
    <p>{report.branch} · {report.date} · {report.shiftId.replace('shift-','Shift ')}<br/>{row.pump} · {row.nozzle} · {change.effectiveTime}</p>
    <div className="reading-final-number"><small>Manual reading</small><strong>{reading}</strong></div>
    <p>Confirm the totalizer reading at the price-change time. This will be recorded as a manual entry.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="reading-final-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="confirm-button" disabled={busy} onClick={onConfirm}>{busy?'Saving manual reading…':'Confirm manual reading'}</button></div>
  </dialog>;
}

export function TemporaryPriceReading({report,change,row,onSaved,onBusy,disabled=false}){
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [now,setNow]=useState(Date.now);
  const saving=useRef(false);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{onBusy?.('manual:'+row.id,busy,busy);return()=>onBusy?.('manual:'+row.id,false,false);},[busy,onBusy,row.id]);
  const allowed=window.__fueltechPilotConfig?.mode==='live'&&temporaryManualPriceOpen(report,change,now);
  const value=Number(draft),blocked=draft.trim()===''||!Number.isFinite(value)||value<Number(row.opening)||value>1e12||(row.finalClosing!==''&&row.finalClosing!=null&&value>Number(row.finalClosing));
  if(!allowed&&!row.temporaryManualConfirmed)return null;
  async function confirm(){
    if(!review||saving.current)return;
    saving.current=true;setBusy(true);setError('');
    try{
      const saved=await pilotPost('/api/demo/temporary-price-reading',review.input,'',{mutationId:review.mutationId});
      await onSaved({...row,closing:Number(review.input.reading),readingConfirmed:true,closingEntered:true},saved);
      setReview(null);setEditing(false);setDraft('');
    }catch(error){setError(error.message||'The manual reading could not be verified. Retry saving this same reading.');}
    finally{saving.current=false;setBusy(false);}
  }
  return <aside className="neutral" data-manual-row-id={row.id} aria-label={`${row.pump} ${row.nozzle} temporary manual input`}>
    <strong>{row.pump} · {row.nozzle}</strong>
    {row.temporaryManualConfirmed&&row.photo_path&&<img src={row.photo_path} alt="Original saved price-change photo" className="totalizer-photo"/>}
    {row.temporaryManualConfirmed&&<p className="success-box">✓ Manual price-change reading saved: <strong>{Number(row.closing).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3})}</strong></p>}
    {allowed&&<><p><strong>Temporary manual input · Barili {report.date} {report.shiftId.replace('shift-','Shift ')} · {change.product}</strong><br/>Available until manager confirmation or November 11, 5:30 PM Manila time. You can type the price-change reading if the photo step cannot finish.</p>
      {!editing?<button type="button" className="secondary" disabled={busy||disabled} onClick={()=>{setDraft(row.readingConfirmed?String(row.closing):'');setEditing(true);setError('');}}>Enter price-change reading manually</button>:<>
        <label>Manual price-change reading<input aria-label={`${row.pump} ${row.nozzle} manual price-change reading`} inputMode="decimal" autoComplete="off" value={draft} disabled={busy||disabled} onChange={event=>{setDraft(event.target.value);setError('');}}/></label>
        <small>Opening: {Number(row.opening).toFixed(2)}{row.finalClosing!==''&&row.finalClosing!=null?` · Shift closing: ${Number(row.finalClosing).toFixed(2)}`:''}</small>
        {draft!==''&&blocked&&<p className="error">Enter a number between opening and the confirmed closing.</p>}
        <button type="button" className="confirm-button" disabled={busy||disabled||blocked} onClick={()=>setReview({mutationId:crypto.randomUUID(),input:{reportKey:`${report.branch}__${report.date}__${report.shiftId}`,changeId:change.id,product:change.product,effectiveTime:change.effectiveTime,rowId:row.id,revision:row.readingRevision||0,reading:draft}})}>Review manual reading</button>
      </>}
    </>}
    {review&&<ManualPriceReview reading={review.input.reading} report={report} change={change} row={row} busy={busy} error={error} onCancel={()=>{setReview(null);setError('');}} onConfirm={confirm}/>}
  </aside>;
}
