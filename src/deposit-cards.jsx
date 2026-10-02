import { useEffect, useState } from 'react';
import { depositAmounts, money } from './error-reduction.ts';

const php=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
const shiftName=id=>id.replace('shift-','Shift ');
const dayLabel=date=>new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`));
const emptyForm=()=>({bank:'PNB',reference:'',amount:'',partial:false,note:''});

export function ManagerDepositCards({branch,api,HistoryCard}) {
  const [date,setDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  const [data,setData]=useState(null);
  const [keys,setKeys]=useState([]);
  const [carryIds,setCarryIds]=useState([]);
  const [page,setPage]=useState('cards');
  const [historyId,setHistoryId]=useState(null);
  const [form,setForm]=useState(emptyForm);
  const [adjustments,setAdjustments]=useState([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;
    api('deposits',{branch,date}).then(value=>{if(active){setData(value);setError('');}}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[api,branch,date,revision]);
  const refresh=()=>{setData(null);setKeys([]);setCarryIds([]);setPage('cards');setRevision(n=>n+1);};
  const available=data?.coverage.reports||[];
  const balances=(data?.deposits||[]).filter(d=>data.coverage.carryoverSourceIds.includes(d.id));
  const selected=available.filter(r=>keys.includes(r.key));
  const selectedBalances=balances.filter(d=>carryIds.includes(d.id));
  const cash=money(selected.reduce((sum,r)=>sum+r.cash,0));
  const carry=money(selectedBalances.reduce((sum,d)=>sum+d.carryoverRemaining,0));
  const count=selected.length+selectedBalances.length;
  const toggle=(value,set,id)=>set(value.includes(id)?value.filter(k=>k!==id):[...value,id]);
  let totals,calcError='';
  try {totals=depositAmounts(cash,carry,adjustments,Number(form.amount||0),form.partial);} catch(e) {calcError=e.message;}
  const invalid=calcError||!form.bank.trim()||!form.reference.trim()||form.amount.trim()===''||(form.partial&&!form.note.trim())||adjustments.some(a=>a.type==='OTHER_APPROVED_EXPENSE'&&!a.note.trim());
  const blockedDay=data?.noDepositDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const selectedHistory=data?.deposits.find(d=>d.id===historyId);
  function begin(){setForm(emptyForm());setAdjustments([]);setError('');setMessage('');setPage('form');}
  async function submit(){
    setBusy(true);setError('');
    try {
      await api('deposit-submit',{...form,branch,depositDate:date,adjustments,coveredReportKeys:keys,carryoverSourceIds:carryIds,reviewedCoveredCash:cash,reviewedCarryover:carry});
      setMessage('Deposit sent for bank verification. Your other shifts are still available.');refresh();
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  function updateAdjustment(index,field,value){setAdjustments(rows=>rows.map((row,i)=>i===index?{...row,[field]:value}:row));}
  const coverageDetails=<details className="deposit-optional"><summary>Selected shifts and balances ({count})</summary><div className="coverage-list">{selected.map(r=><div key={r.key}><span>{dayLabel(r.date)} · {shiftName(r.shiftId)}</span><b>{php(r.cash)}</b></div>)}{selectedBalances.map(d=><div key={d.id}><span>Remaining from {d.reference}</span><b>{php(d.carryoverRemaining)}</b></div>)}</div></details>;

  return <section className="section deposit-upgrade" aria-label="Manager bank deposits">
    <div className="deposit-heading"><div><h2>Bank Deposits</h2><p>{page==='cards'?'Select one shift or choose several to make one bank deposit.':page==='history'?'Deposit details':page==='review'?'Check these details, then send for bank verification.':'Enter the details from your bank deposit slip.'}</p></div>{page==='cards'?<label>Deposit date<input type="date" value={date} onChange={e=>{setDate(e.target.value);setData(null);setKeys([]);setCarryIds([]);setMessage('');}}/></label>:<button type="button" className="secondary" disabled={busy} onClick={()=>{setPage('cards');setError('');}}>← Back to deposit cards</button>}</div>
    {message&&<p className="deposit-success" role="status">✓ {message}</p>}
    {error&&<div role="alert" className="error"><p>{error}</p><button type="button" className="secondary" disabled={busy} onClick={refresh}>Refresh available shifts</button></div>}
    {!data&&!error&&<p role="status">Loading deposit cards…</p>}
    {data&&page==='cards'&&<>
      <div className="deposit-selection-bar"><div><strong>{count?`${count} selected · ${php(cash+carry)}`:'Choose shifts to deposit'}</strong><small>Only submitted shifts due on this date are available.</small></div><div className="demo-actions"><button type="button" className="secondary" disabled={!available.length} onClick={()=>setKeys(keys.length===available.length?[]:available.map(r=>r.key))}>{available.length&&keys.length===available.length?'Clear shifts':'Select all shifts'}</button><button type="button" className="primary" disabled={!count||blockedDay} onClick={begin}>Create deposit{count?` (${count})`:''} →</button></div></div>
      {blockedDay&&<p className="warning-box">This is a no-deposit day. Choose another deposit date.</p>}
      {!available.length&&!balances.length&&<div className="deposit-empty"><h3>No shifts waiting for deposit</h3><p>Submitted shifts appear here when due. Shifts already included in a pending or verified deposit are excluded.</p></div>}
      {[...new Set(available.map(r=>r.date))].map(day=><div className="deposit-day" key={day}><h3>{dayLabel(day)}</h3><div className="deposit-card-grid">{available.filter(r=>r.date===day).map(r=><label className={`deposit-shift-card ${keys.includes(r.key)?'selected':''}`} key={r.key}><span className="deposit-card-top"><strong>{shiftName(r.shiftId)}</strong><input type="checkbox" aria-label={`Select ${dayLabel(day)} ${shiftName(r.shiftId)}`} checked={keys.includes(r.key)} onChange={()=>toggle(keys,setKeys,r.key)}/></span><span className="deposit-card-status">Ready to deposit</span><span className="deposit-card-amount">{php(r.cash)}</span><small>Cash counted by cashier</small><span className="deposit-card-bottom">{keys.includes(r.key)?'✓ Selected':'Select shift'}</span></label>)}</div></div>)}
      {balances.length>0&&<div className="deposit-day"><h3>Remaining cash from earlier deposits</h3><div className="deposit-card-grid">{balances.map(d=><label className={`deposit-shift-card ${carryIds.includes(d.id)?'selected':''}`} key={d.id}><span className="deposit-card-top"><strong>Remaining balance</strong><input type="checkbox" aria-label={`Select balance ${d.reference}`} checked={carryIds.includes(d.id)} onChange={()=>toggle(carryIds,setCarryIds,d.id)}/></span><small>{dayLabel(d.depositDate)} · {d.reference}</small><span className="deposit-card-amount">{php(d.carryoverRemaining)}</span><small>Earlier partial deposit verified</small><span className="deposit-card-bottom">{carryIds.includes(d.id)?'✓ Selected':'Select balance'}</span></label>)}</div></div>}
      <h3>Submitted deposits</h3>{!data.deposits.length&&<p>No deposits submitted yet.</p>}<div className="deposit-card-grid">{[...data.deposits].reverse().map(d=><button type="button" className="deposit-shift-card saved" key={d.id} onClick={()=>{setHistoryId(d.id);setPage('history');}}><span className="deposit-card-top"><strong>{dayLabel(d.depositDate)}</strong><span className={`deposit-card-status ${d.status}`}>{d.status==='pending'?'For verification':d.status==='verified'?'Verified':'Rejected'}</span></span><span>{d.bank} · {d.reference}</span><span className="deposit-card-amount">{php(d.amount)}</span><small>{d.coveredReportKeys.length} shift{d.coveredReportKeys.length===1?'':'s'}{d.carryoverSourceIds.length?' + earlier balance':''}{d.partial?' · Partial deposit':''}</small><span className="deposit-card-bottom">View deposit →</span></button>)}</div>
    </>}
    {data&&page==='history'&&selectedHistory&&<HistoryCard deposit={selectedHistory} role="Manager"/>}
    {data&&(page==='form'||page==='review')&&<div className="deposit-form">
      <div className="deposit-step-label">{page==='form'?'1. Deposit details':'2. Review deposit'} · {dayLabel(date)}</div>
      <div className="deposit-total"><span>Cash selected for this deposit</span><strong>{php(cash+carry)}</strong><small>{selected.length} shift{selected.length===1?'':'s'}{selectedBalances.length?` + ${selectedBalances.length} earlier balance(s)`:''}</small></div>
      {coverageDetails}
      {page==='form'?<form onSubmit={e=>{e.preventDefault();if(!invalid)setPage('review');}}>
        <div className="grid three"><label>Bank<input required value={form.bank} onChange={e=>setForm({...form,bank:e.target.value})}/></label><label>Reference number<input required value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})}/></label><label>Amount deposited<input required inputMode="decimal" value={form.amount} placeholder="Enter amount on slip" onChange={e=>setForm({...form,amount:e.target.value})}/></label></div>
        <details className="deposit-optional"><summary>Expenses or bank fees (optional){adjustments.length?` · ${adjustments.length} added`:''}</summary><p>These are deducted from the selected cash.</p>{adjustments.map((a,i)=><div className="adjustment-row" key={i}><select aria-label={`Expense ${i+1} category`} value={a.type} onChange={e=>updateAdjustment(i,'type',e.target.value)}><option value="TRANSPORTATION">Transportation</option><option value="BANK_FEE">Bank fee</option><option value="OTHER_APPROVED_EXPENSE">Other approved expense</option></select><input aria-label={`Expense ${i+1} amount`} placeholder="Amount" inputMode="decimal" value={a.amount} onChange={e=>updateAdjustment(i,'amount',e.target.value)}/><input aria-label={`Expense ${i+1} note`} placeholder="Reason" value={a.note} onChange={e=>updateAdjustment(i,'note',e.target.value)}/><button type="button" className="secondary" onClick={()=>setAdjustments(rows=>rows.filter((_,j)=>j!==i))}>Remove</button></div>)}<button type="button" className="secondary" onClick={()=>setAdjustments(rows=>[...rows,{type:'TRANSPORTATION',amount:'',note:''}])}>Add expense</button></details>
        {form.amount!==''&&totals&&Number(form.amount)<totals.expected&&<label className="partial-toggle"><input type="checkbox" checked={form.partial} onChange={e=>setForm({...form,partial:e.target.checked})}/>I am keeping some cash for a later deposit</label>}
        {form.partial&&<><label>Reason for keeping cash<input required value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>{calcError&&<button type="button" className="secondary" onClick={()=>setForm({...form,partial:false,note:''})}>Deposit the full amount instead</button>}</>}
        {calcError&&<p className="error" role="alert">{calcError}</p>}
        <div className="deposit-form-footer"><span>Expected on bank slip <b>{totals?php(totals.expected):'—'}</b></span><button type="submit" className="primary" disabled={!!invalid}>Review deposit →</button></div>
      </form>:<>
        <dl className="deposit-review"><div><dt>Bank</dt><dd>{form.bank}</dd></div><div><dt>Reference</dt><dd>{form.reference}</dd></div><div><dt>Expenses / fees</dt><dd>{php(cash+carry-totals.expected)}</dd></div><div><dt>Expected deposit</dt><dd>{php(totals.expected)}</dd></div><div><dt>Amount on bank slip</dt><dd><strong>{php(form.amount)}</strong></dd></div></dl>
        {adjustments.map((a,i)=><p key={i}>{a.type.replaceAll('_',' ')} · {php(a.amount)}{a.note?` · ${a.note}`:''}</p>)}
        {form.partial?<p className="warning-box">{php(totals.carryoverRemaining)} kept for a later deposit. It becomes selectable after bank verification.<br/>{form.note}</p>:totals.unexplainedDifference!==0?<p className="warning-box">The bank amount is {php(Math.abs(totals.unexplainedDifference))} {totals.unexplainedDifference>0?'less':'more'} than expected. This difference will be recorded for review.</p>:<p className="deposit-success">✓ The deposit amount matches the selected cash after expenses.</p>}
        <div className="deposit-form-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>setPage('form')}>← Edit details</button><button type="button" className="confirm-button" disabled={busy||!!invalid} onClick={submit}>{busy?'Submitting…':'Submit for bank verification'}</button></div>
      </>}
    </div>}
  </section>;
}
