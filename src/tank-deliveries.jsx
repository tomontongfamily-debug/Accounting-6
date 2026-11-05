import {useRef,useState} from 'react';
import {newTankDelivery,tankDeliveryError} from './tank-deliveries.js';

export function TankDeliveries({report,onSave}){
  const [draft,setDraft]=useState({driverName:'',product:'',liters:'',time:''});
  const [busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const entry=useRef(null);
  function update(key,value){setDraft(old=>({...old,[key]:value}));entry.current=null;setError('');setMessage('');}
  async function save(){
    const delivery=entry.current||newTankDelivery(draft,crypto.randomUUID()),issue=tankDeliveryError(delivery);
    if(issue){setError(issue);return;}
    entry.current=delivery;setBusy(true);setError('');setMessage('');
    try{
      const result=await onSave(delivery);
      if(!result?.ok)throw Error(result?.error||'Delivery could not be saved.');
      entry.current=null;setPending(false);setDraft(old=>({...old,liters:''}));setMessage(result.alreadyRecorded?'This delivery is already saved.':'Delivery saved.');
    }catch(e){setPending(e.saveUncertain===true||e.status>=500);setError(e.message||'Delivery could not be saved.');}
    finally{setBusy(false);}
  }
  return <section className="delivery-section" aria-label="Fuel deliveries" aria-busy={busy}>
    <h3>Fuel delivery</h3><p>Enter the driver, fuel, liters and time. This delivery belongs to {report.branch} · {report.date} · {report.shiftId.replace('shift-','Shift ')}.</p>
    {!report.confirmed&&<>
      <fieldset className="grid four" disabled={busy||pending} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <label>Driver name<input autoComplete="off" maxLength={80} value={draft.driverName} onChange={e=>update('driverName',e.target.value)}/></label>
        <label>Fuel<select aria-label="Fuel" value={draft.product} onChange={e=>update('product',e.target.value)}><option value="">Choose fuel</option>{['Premium','Regular','Diesel'].map(p=><option key={p}>{p}</option>)}</select></label>
        <label>Liters delivered<input inputMode="decimal" value={draft.liters} onChange={e=>update('liters',e.target.value)}/></label>
        <label>Delivery time<input type="time" value={draft.time} onChange={e=>update('time',e.target.value)}/></label>
      </fieldset>
      <button type="button" className="primary form-space" disabled={busy} onClick={save}>{busy?'Saving delivery…':pending?'Retry saving delivery':'Save delivery'}</button>
    </>}
    {error&&<p className="error" role="alert">{error}{pending?' Your delivery details are kept. Retry saving before changing them.':''}</p>}
    {message&&<p role="status">{message}</p>}
    {(report.deliveries||[]).map(d=><p key={d.id}><strong>{d.driverName||'Earlier delivery'}</strong> · {d.product} · {Number(d.liters).toLocaleString('en-PH')} L · {d.time}{d.reference&&<small> · Reference: {d.reference}</small>}</p>)}
  </section>;
}
