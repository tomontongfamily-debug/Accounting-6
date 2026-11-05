import {useRef,useState} from 'react';
import {DELIVERY_PRODUCTS,newTankDeliveryLoad,tankDeliveryLoadError,groupTankDeliveries} from './tank-deliveries.js';

export function TankDeliveries({report,onSave}){
  const [draft,setDraft]=useState({driverName:'',litersByProduct:{},time:''});
  const [busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const entry=useRef(null);
  function update(key,value){setDraft(old=>({...old,[key]:value}));entry.current=null;setError('');setMessage('');}
  async function save(){
    const delivery=entry.current||newTankDeliveryLoad(draft,crypto.randomUUID()),issue=tankDeliveryLoadError(delivery);
    if(issue){setError(issue);return;}
    entry.current=delivery;setBusy(true);setError('');setMessage('');
    try{
      const result=await onSave(delivery);
      if(!result?.ok)throw Error(result?.error||'Delivery could not be saved.');
      entry.current=null;setPending(false);setDraft(old=>({...old,litersByProduct:{}}));setMessage(result.alreadyRecorded?'This delivery is already saved.':'Delivery saved.');
    }catch(e){setPending(e.saveUncertain===true||e.status>=500);setError(e.message||'Delivery could not be saved.');}
    finally{setBusy(false);}
  }
  return <section className="delivery-section" aria-label="Fuel deliveries" aria-busy={busy}>
    <h3>Fuel delivery</h3><p>One delivery, one driver and time. Fill in the liters delivered for each fuel; leave the others blank.</p>
    <p>{report.branch} · {report.date} · {report.shiftId.replace('shift-','Shift ')}</p>
    {!report.confirmed&&<>
      <fieldset disabled={busy||pending} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <div className="grid two">
        <label>Driver name<input autoComplete="off" maxLength={80} value={draft.driverName} onChange={e=>update('driverName',e.target.value)}/></label>
        <label>Delivery time<input type="time" value={draft.time} onChange={e=>update('time',e.target.value)}/></label>
        </div>
        <div className="grid three form-space">
          {DELIVERY_PRODUCTS.map(product=><label key={product}>{product} liters<input inputMode="decimal" value={draft.litersByProduct[product]||''} onChange={e=>update('litersByProduct',{...draft.litersByProduct,[product]:e.target.value})}/></label>)}
        </div>
      </fieldset>
      <button type="button" className="primary form-space" disabled={busy} onClick={save}>{busy?'Saving delivery…':pending?'Retry saving delivery':'Save delivery'}</button>
    </>}
    {error&&<p className="error" role="alert">{error}{pending?' Your delivery details are kept. Retry saving before changing them.':''}</p>}
    {message&&<p role="status">{message}</p>}
    {groupTankDeliveries(report.deliveries).map(d=><div key={d.id} aria-label="Saved delivery" className="form-space">
      <p><strong>{d.driverName||'Earlier delivery'}</strong> · {d.time}{d.reference&&<small> · Reference: {d.reference}</small>}</p>
      <ul>{d.items.map(item=><li key={item.product}>{item.product}: <strong>{Number(item.liters).toLocaleString('en-PH')} L</strong></li>)}</ul>
      {d.items.length>1&&<p>Total: <strong>{d.items.reduce((sum,item)=>sum+Number(item.liters),0).toLocaleString('en-PH')} L</strong></p>}
    </div>)}
  </section>;
}
