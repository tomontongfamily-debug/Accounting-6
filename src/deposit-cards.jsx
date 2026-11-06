import { useEffect, useState } from 'react';
import { depositAmounts, money } from './error-reduction.ts';
import { depositCoverage, depositDayLabel } from './deposit-coverage.js';
import { DepositCoverageLines } from './deposit-coverage.jsx';

const php=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
const shiftName=id=>id.replace('shift-','Shift ');
const dayLabel=depositDayLabel;
  const emptyForm=()=>({bank:'PNB',reference:'',amount:'',receiptPath:'',note:''});
async function receiptImage(file) {
  if(!file||!file.type.startsWith('image/'))throw Error('Choose a receipt photo.');
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=url;await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('This photo could not be opened. Try a JPEG or PNG receipt.'));});
    const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    for(const quality of [.9,.8,.65,.5]){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<2700000)return data;}
    throw Error('Receipt photo is too large. Take a closer photo.');
  } finally {URL.revokeObjectURL(url);}
}

export function ManagerDepositCards({branch,api,HistoryCard}) {
  const [date,setDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  const [data,setData]=useState(null);
  const [keys,setKeys]=useState([]);
  const [carryIds,setCarryIds]=useState([]);
  const [amounts,setAmounts]=useState({});
  const [uploading,setUploading]=useState(false);
  const [page,setPage]=useState('cards');
  const [historyId,setHistoryId]=useState(null);
  const [form,setForm]=useState(emptyForm);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;
    api('deposits',{branch,date}).then(value=>{if(active){setData(value);setError('');}}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[api,branch,date,revision]);
  const refresh=()=>{setData(null);setKeys([]);setCarryIds([]);setAmounts({});setPage('cards');setRevision(n=>n+1);};
  const available=data?.coverage.reports||[];
  const balances=(data?.deposits||[]).filter(d=>data.coverage.carryoverSourceIds.includes(d.id)).map(d=>({...d,availableCash:data.coverage.carryoverBalances?.find(c=>c.id===d.id)?.availableCash??d.carryoverRemaining}));
  const selected=available.filter(r=>keys.includes(r.key));
  const selectedBalances=balances.filter(d=>carryIds.includes(d.id));
  const shiftAmount=r=>amounts[r.key]??String(r.cash);
  const carryAmount=d=>amounts['carry:'+d.id]??String(d.availableCash);
  const cash=money(selected.reduce((sum,r)=>sum+Number(shiftAmount(r)||0),0));
  const carry=money(selectedBalances.reduce((sum,d)=>sum+Number(carryAmount(d)||0),0));
  const count=selected.length+selectedBalances.length;
  const toggle=(value,set,id)=>set(value.includes(id)?value.filter(k=>k!==id):[...value,id]);
  let totals,calcError='';
  try {totals=depositAmounts(cash,carry,[],Number(form.amount||0),false);} catch(e) {calcError=e.message;}
  const badAllocation=(value,maximum)=>!/^\d+(?:\.\d{1,2})?$/.test(String(value))||Number(value)<=0||Number(value)>maximum;
  const allocationError=selected.some(r=>badAllocation(shiftAmount(r),r.cash))||selectedBalances.some(d=>badAllocation(carryAmount(d),d.availableCash));
  const invalid=calcError||!count||allocationError||!form.bank.trim()||uploading||!/^\d+(?:\.\d{1,2})?$/.test(form.amount)||Number(form.amount)<=0||totals?.unexplainedDifference!==0;
  const blockedDay=data?.noDepositDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const selectedHistory=data?.deposits.find(d=>d.id===historyId);
  function begin(){setForm({...emptyForm(),amount:String(cash+carry)});setError('');setMessage('');setPage('form');}
  async function submit(){
    setBusy(true);setError('');
    try {
      await api('deposit-submit',{...form,branch,depositDate:date,allocationVersion:1,adjustments:[],coveredReportKeys:keys,carryoverSourceIds:carryIds,reportAllocations:selected.map(r=>({reportKey:r.key,amount:shiftAmount(r),availableCash:r.cash})),carryoverAllocations:selectedBalances.map(d=>({depositId:d.id,amount:carryAmount(d),availableCash:d.availableCash})),reviewedCoveredCash:cash,reviewedCarryover:carry});
      setMessage('Deposit sent for bank verification. Your other shifts are still available.');refresh();
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  async function uploadReceipt(file) {
    setUploading(true);setError('');
    try {const data=await receiptImage(file),saved=await api('deposit-receipt',{branch,data});setForm(f=>({...f,receiptPath:saved.receiptPath}));}
    catch(e){setError(e.message);}finally{setUploading(false);}
  }
  function suggestAmounts() {
    let remaining=money(Number(form.amount||0));
    if(!Number.isFinite(remaining)||remaining<=0)return;
    const next={...amounts},nextKeys=[],nextCarry=[];
    for(const r of selected){const value=money(Math.min(remaining,r.cash));if(value>0){next[r.key]=String(value);nextKeys.push(r.key);remaining=money(remaining-value);}}
    for(const d of selectedBalances){const value=money(Math.min(remaining,d.availableCash));if(value>0){next['carry:'+d.id]=String(value);nextCarry.push(d.id);remaining=money(remaining-value);}}
    if(remaining>0){setError('Add another shift to cover this deposit amount.');return;}
    setKeys(nextKeys);setCarryIds(nextCarry);setAmounts(next);setError('');
  }
  const coverageDetails=<div className="deposit-allocation-editor"><h3>Money from these shifts</h3><p>Use one shift or add more. Enter only the cash used for this deposit; the rest stays available.</p>
    {selected.map(r=><div className="deposit-allocation-row" key={r.key}><span>{dayLabel(r.date)} · {shiftName(r.shiftId)}<small>Available {php(r.cash)}</small></span>{page==='form'?<><label>Amount from {dayLabel(r.date)} {shiftName(r.shiftId)}<input inputMode="decimal" value={shiftAmount(r)} onChange={e=>setAmounts({...amounts,[r.key]:e.target.value})}/></label><button type="button" className="secondary" aria-label={`Remove ${dayLabel(r.date)} ${shiftName(r.shiftId)}`} onClick={()=>setKeys(keys.filter(k=>k!==r.key))}>Remove shift</button></>:<b>{php(shiftAmount(r))}</b>}</div>)}
    {selectedBalances.map(d=><div className="deposit-allocation-row" key={d.id}><span>Earlier balance · {d.reference}<small>Available {php(d.availableCash)}</small></span>{page==='form'?<><label>Amount from balance {d.reference}<input inputMode="decimal" value={carryAmount(d)} onChange={e=>setAmounts({...amounts,['carry:'+d.id]:e.target.value})}/></label><button type="button" className="secondary" onClick={()=>setCarryIds(carryIds.filter(id=>id!==d.id))}>Remove balance</button></>:<b>{php(carryAmount(d))}</b>}</div>)}
    {page==='form'&&<div className="demo-actions"><label>Add a shift<select aria-label="Add a shift" value="" onChange={e=>{if(e.target.value)setKeys([...keys,e.target.value]);}}><option value="">Choose a shift</option>{available.filter(r=>!keys.includes(r.key)).map(r=><option key={r.key} value={r.key}>{dayLabel(r.date)} · {shiftName(r.shiftId)} · {php(r.cash)}</option>)}</select></label>{balances.some(d=>!carryIds.includes(d.id))&&<label>Add earlier balance<select aria-label="Add earlier balance" value="" onChange={e=>{if(e.target.value)setCarryIds([...carryIds,e.target.value]);}}><option value="">Choose a balance</option>{balances.filter(d=>!carryIds.includes(d.id)).map(d=><option key={d.id} value={d.id}>{d.reference} · {php(d.availableCash)}</option>)}</select></label>}<button type="button" className="secondary" onClick={suggestAmounts} disabled={!count||Number(form.amount)<=0}>Suggest shift amounts</button></div>}
    {allocationError&&<p className="error" role="alert">Each amount must be positive, use up to two decimal places, and stay within that shift's available cash.</p>}
    <p><b>Total cash assigned: {php(cash+carry)}</b></p>
  </div>;

  return <section className="section deposit-upgrade" aria-label="Manager bank deposits">
    <div className="deposit-heading"><div><h2>Bank Deposits</h2><p>{page==='cards'?'Select one shift or choose several to make one bank deposit.':page==='history'?'Deposit details':page==='review'?'Check these details, then send for bank verification.':'Enter the details from your bank deposit slip.'}</p></div>{page==='cards'?<label>Deposit date<input type="date" value={date} onChange={e=>{setDate(e.target.value);setData(null);setKeys([]);setCarryIds([]);setMessage('');}}/></label>:<button type="button" className="secondary" disabled={busy} onClick={()=>{setPage('cards');setError('');}}>← Back to deposit cards</button>}</div>
    {message&&<p className="deposit-success" role="status">✓ {message}</p>}
    {error&&<div role="alert" className="error"><p>{error}</p><button type="button" className="secondary" disabled={busy} onClick={refresh}>Refresh available shifts</button></div>}
    {!data&&!error&&<p role="status">Loading deposit cards…</p>}
    {data&&page==='cards'&&<>
      <div className="deposit-selection-bar"><div><strong>{count?`${count} selected · ${php(cash+carry)}`:'Choose shifts to deposit'}</strong><small>Only submitted shifts due on this date are available.</small></div><div className="demo-actions"><button type="button" className="secondary" disabled={!available.length} onClick={()=>setKeys(keys.length===available.length?[]:available.map(r=>r.key))}>{available.length&&keys.length===available.length?'Clear shifts':'Select all shifts'}</button><button type="button" className="primary" disabled={!count||blockedDay} onClick={begin}>Create deposit{count?` (${count})`:''} →</button></div></div>
      {blockedDay&&<p className="warning-box">This is a no-deposit day. Choose another deposit date.</p>}
      {!available.length&&!balances.length&&<div className="deposit-empty"><h3>No shifts waiting for deposit</h3><p>Submitted shifts appear here when due. Fully allocated shifts are excluded. Unused shift cash stays available.</p></div>}
      {[...new Set(available.map(r=>r.date))].map(day=><div className="deposit-day" key={day}><h3>{dayLabel(day)}</h3><div className="deposit-card-grid">{available.filter(r=>r.date===day).map(r=><label className={`deposit-shift-card ${keys.includes(r.key)?'selected':''}`} key={r.key}><span className="deposit-card-top"><strong>{shiftName(r.shiftId)}</strong><input type="checkbox" aria-label={`Select ${dayLabel(day)} ${shiftName(r.shiftId)}`} checked={keys.includes(r.key)} onChange={()=>toggle(keys,setKeys,r.key)}/></span><span className="deposit-card-status">Ready to deposit</span><span className="deposit-card-amount">{php(r.cash)}</span><small>Available cash from this shift</small><span className="deposit-card-bottom">{keys.includes(r.key)?'✓ Selected':'Select shift'}</span></label>)}</div></div>)}
      {balances.length>0&&<div className="deposit-day"><h3>Remaining cash from earlier deposits</h3><div className="deposit-card-grid">{balances.map(d=><label className={`deposit-shift-card ${carryIds.includes(d.id)?'selected':''}`} key={d.id}><span className="deposit-card-top"><strong>{depositCoverage(d,data.deposits).title}</strong><input type="checkbox" aria-label={`Select balance ${d.reference}`} checked={carryIds.includes(d.id)} onChange={()=>toggle(carryIds,setCarryIds,d.id)}/></span><DepositCoverageLines deposit={d} deposits={data.deposits}/><span className="deposit-card-amount">{php(d.availableCash)}</span><small>Remaining balance · {d.reference}</small><span className="deposit-card-bottom">{carryIds.includes(d.id)?'✓ Selected':'Select balance'}</span></label>)}</div></div>}
      <h3>Submitted deposits</h3><p>Each card shows the cashier reports covered by that deposit.</p>{!data.deposits.length&&<p>No deposits submitted yet.</p>}<div className="deposit-card-grid">{[...data.deposits].reverse().map(d=><button type="button" className="deposit-shift-card saved" key={d.id} onClick={()=>{setHistoryId(d.id);setPage('history');}}><span className="deposit-card-top"><strong>{depositCoverage(d,data.deposits).title}</strong><span className={`deposit-card-status ${d.status}`}>{d.status==='pending'?'For verification':d.status==='verified'?'Verified':'Rejected'}</span></span><DepositCoverageLines deposit={d} deposits={data.deposits}/><span className="deposit-card-amount">{php(d.amount)}</span><span>{d.bank} · {d.reference}{d.partial?' · Partial deposit':''}</span><small>Bank deposit date: {dayLabel(d.depositDate)}</small><span className="deposit-card-bottom">View deposit →</span></button>)}</div>
    </>}
    {data&&page==='history'&&selectedHistory&&<HistoryCard deposit={selectedHistory} deposits={data.deposits} role="Manager"/>}
    {data&&(page==='form'||page==='review')&&<div className="deposit-form">
      <div className="deposit-step-label">{page==='form'?'1. Deposit details':'2. Review deposit'} · {dayLabel(date)}</div>
      <div className="deposit-total"><span>Cash selected for this deposit</span><strong>{php(cash+carry)}</strong><small>{selected.length} shift{selected.length===1?'':'s'}{selectedBalances.length?` + ${selectedBalances.length} earlier balance(s)`:''}</small></div>
      {page==='review'&&coverageDetails}
      {page==='form'?<form onSubmit={e=>{e.preventDefault();if(!invalid)setPage('review');}}>
        <div className="grid three"><label>Bank<input required value={form.bank} onChange={e=>setForm({...form,bank:e.target.value})}/></label><label>Reference number<input placeholder="Optional bank reference" value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})}/></label><label>Amount deposited<input required inputMode="decimal" value={form.amount} placeholder="Enter amount on slip" onChange={e=>setForm({...form,amount:e.target.value})}/></label></div>
        <label>Receipt photo (optional)<input type="file" accept="image/*" disabled={uploading||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)uploadReceipt(file);}}/></label>
        {uploading&&<p role="status">Saving receipt photo…</p>}{form.receiptPath&&<p className="deposit-success">✓ Receipt saved · <a href={form.receiptPath} target="_blank" rel="noreferrer">View receipt</a></p>}
        {coverageDetails}
        <p>Record bank fees and transportation through CV.</p>
        {form.amount!==''&&totals&&totals.unexplainedDifference!==0&&<p className="warning-box" role="status">Assign {php(Math.abs(totals.unexplainedDifference))} {totals.unexplainedDifference>0?'less':'more'} from the selected shifts so the bank amount matches.</p>}
        {calcError&&<p className="error" role="alert">{calcError}</p>}
        <div className="deposit-form-footer"><span>Expected on bank slip <b>{totals?php(totals.expected):'—'}</b></span><button type="submit" className="primary" disabled={!!invalid}>Review deposit →</button></div>
      </form>:<>
        <dl className="deposit-review"><div><dt>Bank</dt><dd>{form.bank}</dd></div><div><dt>Reference</dt><dd>{form.reference}</dd></div><div><dt>Expected deposit</dt><dd>{php(totals.expected)}</dd></div><div><dt>Amount on bank slip</dt><dd><strong>{php(form.amount)}</strong></dd></div></dl>
        <p className="deposit-success">✓ The deposit amount matches the selected cash. Unused cash stays available.</p>
        {form.receiptPath&&<p><a href={form.receiptPath} target="_blank" rel="noreferrer">View saved bank receipt</a></p>}
        <div className="deposit-form-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>setPage('form')}>← Edit details</button><button type="button" className="confirm-button" disabled={busy||!!invalid} onClick={submit}>{busy?'Submitting…':'Submit for bank verification'}</button></div>
      </>}
    </div>}
  </section>;
}
