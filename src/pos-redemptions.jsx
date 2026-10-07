import { posRedemptionComparison } from './pos-redemptions.js';
import './pos-redemptions.css';
const peso=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value);
const localTime=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila'});
export function PosRedemptions({report}) {
  const comparison=posRedemptionComparison(report);
  if(!comparison)return null;
  const {evidence,entered,difference,fresh}=comparison;
  const verified=evidence.status==='verified', copied=!!evidence.verifiedAt;
  return <section className="pos-redemptions" aria-label="POS redemption comparison">
    <h3>POS redemptions · Liloan</h3>
    <p className={!verified||difference!==0?'pos-warning':''} role={!verified||difference!==0?'status':undefined}>
      {verified?(difference===0?'Cash + fuel entries match the POS total.':`Check required: cash + fuel entries differ from POS by ${peso(Math.abs(difference))}.`):evidence.status==='disabled'?'POS connection is paused. The last verified copy is shown.':'POS is unavailable. Keep the last verified copy and check again.'}
    </p>
    {copied?<>
      <div className="pos-values">
        <div><span>POS monetary redemptions</span><strong>{peso(evidence.cashTotal)}</strong><small>{evidence.cashCount} records</small></div>
        <div><span>Entered cash + fuel</span><strong>{peso(entered)}</strong><small>{difference>0?'Entries exceed POS':difference<0?'POS exceeds entries':'Matched'}</small></div>
        <div><span>Coke redemption reference</span><strong>{evidence.cokeQuantity} bottles · {peso(evidence.cokeTotal)}</strong><small>Compare with Coke CV; already deducted vouchers must not be deducted twice.</small></div>
      </div>
      <p><small>Verified {localTime(evidence.verifiedAt)}{fresh?'':' · Last verified copy; refresh to check again.'}</small></p>
      <details><summary>View {evidence.rows.length} POS records</summary>
        {evidence.rows.length?<div className="pos-table"><table><thead><tr><th>Time (Manila)</th><th>Type</th><th>Amount</th><th>Record ID</th></tr></thead><tbody>{evidence.rows.map(row=><tr key={row.id}><td>{localTime(row.at)}</td><td>{row.type==='Coke'?`Coke · ${row.quantity} bottles`:'Monetary'}</td><td>{peso(row.amount)}</td><td><code>{row.id}</code></td></tr>)}</tbody></table></div>:<p>No POS redemptions in this shift as of the verification time.</p>}
      </details>
    </>:<p>No verified POS copy is available yet. This does not mean zero redemptions.</p>}
    <p><small>POS groups cash and fuel together. Review their split in Accounting. This comparison leaves entered deductions and cash counts unchanged.</small></p>
  </section>;
}
