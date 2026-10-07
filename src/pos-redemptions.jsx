import { posRedemptionComparison } from './pos-redemptions.js';
import './pos-redemptions.css';
const peso=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value);
const localTime=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila'});
export function PosRedemptions({report}) {
  const comparison=posRedemptionComparison(report);
  if(!comparison)return null;
  const {evidence,entered,difference,fresh}=comparison;
  const verified=evidence.status==='verified',copied=!!evidence.verifiedAt;
  return <section className="pos-redemptions" aria-label="POS redemption comparison">
    <h3>Automatic POS · Liloan</h3>
    <p className={!verified||difference!==0?'pos-warning':''} role={!verified||difference!==0?'status':undefined}>
      {verified?(difference===0?'POS monetary redemptions are deducted automatically, once.':`Check required: Accounting deduction differs from POS by ${peso(Math.abs(difference))}.`):evidence.status==='disabled'?'POS connection is paused. The last verified copy is shown.':'POS is unavailable. The last verified deduction is retained; refresh before checking or submitting cash.'}
    </p>
    {copied?<>
      <div className="pos-values">
        <div><span>Automatic monetary deduction</span><strong>{peso(entered)}</strong><small>{evidence.cashCount} POS records · cash and fuel combined</small></div>
        <div><span>Points issued</span><strong>{evidence.pointsStatus==='verified'?peso(report.pointsIssued):'Needs POS review'}</strong><small>{evidence.pointsStatus==='verified'?`${evidence.pointsCount} transactions · ${evidence.voidedCount} voided excluded`:'Previous points value retained; monetary redemptions remain automatic.'}</small></div>
        <div><span>Coke redemption reference</span><strong>{evidence.cokeQuantity} bottles · {peso(evidence.cokeTotal)}</strong><small>Compare with Coke CV; vouchers supply the cash deduction.</small></div>
      </div>
      {evidence.pointIssues?.length>0&&<p className="pos-warning">Points need review: {evidence.pointIssues.map(r=>`${r.id}: ${r.issue}`).join('; ')}.</p>}
      {report.posAutomaticAdjustment&&<p><small>Previously entered cash + fuel: {peso(Number(report.posAutomaticAdjustment.original.deductions?.cashRedemption||0)+Number(report.posAutomaticAdjustment.original.deductions?.fuelRedemption||0))}. Original entry preserved in the adjustment history.</small></p>}
      <p><small>Verified {localTime(evidence.verifiedAt)}{fresh?'':' · Last verified copy; refresh to check again.'}</small></p>
      <details><summary>View {evidence.rows.length} POS records</summary>
        {evidence.rows.length?<div className="pos-table"><table><thead><tr><th>Time (Manila)</th><th>Type</th><th>Amount</th><th>Record ID</th></tr></thead><tbody>{evidence.rows.map(row=><tr key={row.id}><td>{localTime(row.at)}</td><td>{row.type==='Coke'?`Coke · ${row.quantity} bottles`:'Monetary'}</td><td>{peso(row.amount)}</td><td><code>{row.id}</code></td></tr>)}</tbody></table></div>:<p>No POS redemptions in this shift as of the verification time.</p>}
      </details>
    </>:<p>No verified POS copy is available yet. This does not mean zero redemptions.</p>}
    <p><small>No cash/fuel split entry is required. Count physical cash, tank dips and Coke stock as usual. Accounting reads POS; it cannot change POS transactions.</small></p>
  </section>;
}
