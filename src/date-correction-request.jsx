import {useId,useRef,useState} from 'react';

export function DateCorrectionRequest({branch,draft,setDraft,shifts,onRequest,requestReport,disabled=false}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const fieldsId=useId(),submitting=useRef(false);
  function update(field,value){setError('');setMessage('');setDraft(previous=>({...previous,[field]:value}));}
  async function submit(event){
    event.preventDefault();if(disabled||submitting.current)return;
    submitting.current=true;setBusy(true);setError('');setMessage('');
    try{
      const result=await onRequest();
      if(!result?.ok)throw Error(result?.error||'The correction request could not be verified. Please retry.');
      setMessage(result.message);
    }catch(error){setError(error.message||'Unable to send the correction request.');}
    finally{submitting.current=false;setBusy(false);}
  }
  const pending=requestReport?.correctionRequest?.status==='pending';
  return <section className="cashier-dashboard-correction" aria-label="Date corrections">
    <button type="button" className="secondary" aria-expanded={open} aria-controls={fieldsId} disabled={disabled||busy} onClick={()=>setOpen(previous=>!previous)}>Request Date Correction</button>
    <p>Ask Admin to reopen the exact {branch} report date and shift that needs correction.</p>
    {pending&&<p role="status">{requestReport.date} · {requestReport.shiftId.replace('shift-','Shift ')}: waiting for Admin approval.</p>}
    {open&&<form id={fieldsId} onSubmit={submit}>
      <fieldset className="grid four correction-request-fields" disabled={disabled||busy}>
        <label>Report Date<input type="date" value={draft.date} onChange={event=>update('date',event.target.value)}/></label>
        <label>Shift<select aria-label="Shift" value={draft.shiftId} onChange={event=>update('shiftId',event.target.value)}>{shifts.map(shift=><option key={shift.id} value={shift.id}>{shift.label}</option>)}</select></label>
        <label>Reason<input value={draft.reason} onChange={event=>update('reason',event.target.value)} autoComplete="off"/></label>
        <button type="submit" className="secondary">{busy?'Sending request…':'Send Request to Admin'}</button>
      </fieldset>
    </form>}
    {error&&<p className="error" role="alert">{error}</p>}
    {message&&<p className="success-box" role="status">{message}</p>}
  </section>;
}
