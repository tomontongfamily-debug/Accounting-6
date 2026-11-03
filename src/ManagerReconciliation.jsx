import { approvedManagerReconciliation, managerReconciliationAdjustments } from './manager-reconciliation.js';
const php = value => Number(value || 0).toLocaleString('en-PH',{style:'currency',currency:'PHP'});
export default function ManagerReconciliation({report}) {
  const r=approvedManagerReconciliation(report);
  if(!r)return null;
  const imported=(report.purchaseRows||[]).reduce((s,p)=>s+Number(p.amount||0),0);
  const adjustment=managerReconciliationAdjustments(report,imported,0).cashVouchers;
  return <section className="section"><h3>October manager reconciliation</h3><p>Corrected from {r.sourceName}, Cash Variance row {r.sourceRow}. Original records are retained.</p>
    <p>Manager cash count: <b>{php(r.cashCount)}</b> · Original cash count: {php(r.original?.actualCashCounted)}</p>
    <p>Manager cash vouchers: <b>{php(r.cashVoucherTotal)}</b> · Linked CV records: {php(imported)}</p>
    {Math.abs(adjustment)>=.01&&<p className="error">Unmatched CV adjustment: <b>{php(adjustment)}</b>. Payout receipts and source CVs still need reconciliation.</p>}
    <details><summary>Original readings, prices and cash count</summary><p>Approved {new Date(r.approvedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} · {r.approvedBy}</p><p>Original denomination total remains part of the original cash-count evidence; the manager total above is the approved correction.</p><div className="table-wrap"><table><thead><tr><th>Pump</th><th>Nozzle</th><th>Original closing</th><th>Manager closing</th></tr></thead><tbody>{(r.original?.pumpRows||[]).map(p=><tr key={p.id}><td>{p.pump}</td><td>{p.nozzle}</td><td>{p.closing}</td><td>{report.pumpRows.find(n=>n.pump===p.pump&&n.nozzle===p.nozzle)?.closing}</td></tr>)}</tbody></table></div></details>
  </section>;
}
