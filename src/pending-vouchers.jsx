import {useState} from 'react';
const php=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
export function PendingVouchers({report,onRefresh}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=report.pendingVouchers,rows=pending?.rows||[];
  async function refresh(){setBusy(true);setError('');try{await onRefresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className={rows.length?'warning-box pending-vouchers':'pending-vouchers'} aria-label="Pending CV approvals">
    <h3>Pending CV approvals{rows.length?` (${rows.length})`:''}</h3>
    {!pending||pending.status==='unavailable'?<p>Refresh approval status before checking cash.</p>:<>
      {pending.status==='stale'&&<p>Approval status may have changed. Refresh to check again.</p>}
      {rows.length?<><p>Awaiting approval: <b>{php(pending.cashTotal)} cash</b> · <b>{php(pending.fuelTotal)} fuel</b>. These CVs are not yet included in cash reconciliation.</p>
        <div className="coverage-list">{rows.map(row=><div key={row.sourceVoucherId}><span><b>{row.reference}</b> · {row.paymentType==='fuel'?'Fuel':'Cash'}<small className="cv-source">Funding: {row.date} · Shift {row.shiftId.slice(-1)}{row.amount!==row.totalAmount?` · This shift's share of ${php(row.totalAmount)}`:''}</small></span><strong>{php(row.amount)}</strong></div>)}</div>
        <p>After approval, refresh CV approvals before checking cash again.</p></>:<p>No pending cash or fuel CVs assigned to this shift.</p>}
      {!!pending.unassigned?.length&&<p>{pending.unassigned.map(v=>v.reference).join(', ')}: funding allocation needs review in the CV app.</p>}
      {pending.verifiedAt&&<small>Last checked: {new Date(pending.verifiedAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila'})}</small>}
    </>}
    {onRefresh&&<div><button type="button" className="secondary" disabled={busy} onClick={refresh}>{busy?'Checking CV approvals…':'Refresh CV approvals'}</button></div>}
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
