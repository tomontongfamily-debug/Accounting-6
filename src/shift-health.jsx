import { useState } from 'react';
import { readingWarning } from './error-reduction.ts';

const php=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
export const reasonLabel=category=>({CASH_VARIANCE:'Cash shortage / overage',PUMP_READING:'Pump reading / liters',PUMP_OCR_CORRECTION:'Photo reading correction',MANUAL_DEDUCTION:'Manual deduction',ONLINE_PAY:'Online Pay',PO:'Purchase order',REDEMPTION:'Redemption',FUEL_PRICE:'Fuel price',MID_SHIFT_PRICE:'Mid-shift price',TANK_DELIVERY:'Tank delivery',BANK_DEPOSIT:'Bank deposit',BANK_VERIFIER:'Bank verification',OTHER:'Other issue'}[category]||category.replaceAll('_',' '));
export function shiftReasons(report) {
  if(!report?.confirmed)return [];
  const details=[...(report.checkDetails||[])];
  for(const category of report.checkCategories||[]) if(!details.some(i=>i.category===category)) details.push({category,detail:'This category was flagged, but no detailed reason was saved. Review the entries below.'});
  if(report.checkRequired&&!details.length) details.push({category:'OTHER',detail:'This report requires review, but no specific reason was recorded.'});
  return details;
}
export function StationHealthCell({status,report}) {
  const reasons=shiftReasons(report);
  const setup=Boolean(status.detail) || status.label==='Not Required';
  const review=!setup && (status.needsReview || status.label==='Check Required' || reasons.length>0);
  return <div>
    <span className={'status simple-health-status '+status.tone}>{status.detail||status.label}</span>
    {review && <div className="station-inline-reasons" style={{whiteSpace:'normal',marginTop:8}}>{reasons.length?reasons.map((issue,i)=><p key={i}><b>{reasonLabel(issue.category)}</b><br/>{issue.detail}</p>):<p>Check required: review the cash variance and pump readings.</p>}</div>}
  </div>;
}
const advice=category=>({CASH_VARIANCE:'Compare the cash count with the sales and deduction entries. A cash difference does not establish which entry is wrong.',PUMP_READING:'Compare the closing reading with the pump photo, then check opening → closing and liters sold.',MANUAL_DEDUCTION:'Check the deduction amount, category and description against the voucher or receipt.',ONLINE_PAY:'Compare the imported transactions with the payment records.',PO:'Check the purchase order and linked transactions.',BANK_DEPOSIT:'Compare the bank slip with the selected shifts and expenses.',BANK_VERIFIER:'Check the rejection reason and bank reference.'}[category]||'Compare this entry with its supporting record before correcting it.');

export function ShiftReasons({report}) {
  const reasons=shiftReasons(report);
  const pumpRows=report?.pumpRows||[];
  return <div className="shift-reason-details">
    <p><strong>Cashier:</strong> {report?.cashierName||'Not recorded'} · <strong>Manager:</strong> {report?.managerName||'Demo Manager'}</p>
    {reasons.length?reasons.map((issue,i)=><article className="shift-issue" key={i}><strong>{reasonLabel(issue.category)}</strong><p>{issue.detail}</p><small><b>What to check:</b> {advice(issue.category)}</small></article>):<p>No specific error was recorded for this shift.</p>}
    <details className="deposit-optional"><summary>Pump readings and photos ({pumpRows.length})</summary><p>These are the submitted entries for inspection. A warning means the reading needs checking, not that it is proven wrong.</p>{pumpRows.map(row=>{const warning=readingWarning(row);return <article className="shift-evidence" key={row.id}><strong>{row.pump} · {row.nozzle} · {row.product}</strong><p>Opening {row.opening} → Closing {row.closing}<br/><b>Liters sold: {warning.liters.toLocaleString('en-PH')}</b></p>{warning.level!=='NORMAL'&&<p className="warning-box">{warning.message}</p>}{row.ocr_was_edited&&<small>Photo suggestion corrected by cashier: {row.ocr_detected_reading} → {row.closing}. A correction alone is not an error.</small>}{row.photo_path?<a href={row.photo_path} target="_blank" rel="noreferrer">View pump photo</a>:<small>No pump photo attached to this sample / historical entry.</small>}</article>;})}</details>
    <details className="deposit-optional"><summary>Deductions and vouchers ({(report?.purchaseRows||[]).length})</summary><p>Compare these entries with the receipts. An amount is not marked wrong just because it is a deduction.</p>{(report?.purchaseRows||[]).map((row,i)=><div className="shift-evidence" key={row.id||i}><strong>{row.category||'Category missing'} · {php(row.amount)}</strong><p>{row.item||row.particular||'Description missing'}</p></div>)}{Object.entries(report?.deductions||{}).filter(([,value])=>Number(value)!==0).map(([label,value])=><div className="coverage-list" key={label}><div><span>{label==='gcash'?'Online Pay':label.replace(/([A-Z])/g,' $1')}</span><b>{php(value)}</b></div></div>)}{(report?.poRows||[]).map((row,i)=><p key={row.id||i}>PO · {row.account||row.particular||'Account'} · {php(row.amount)}</p>)}</details>
  </div>;
}

export function StationHealthReview({reports,rows,from,to,setFrom,setTo}) {
  const [station,setStation]=useState('');
  const filtered=rows.filter(row=>!station||row.branch===station);
  const statuses=filtered.flatMap(row=>row.shifts.map(s=>s.status.label));
  const issues=filtered.flatMap(row=>row.shifts).filter(({status})=>status.needsReview||status.label==='Check Required').length;
  return <section className="section simple-station-health" id="admin-section-station-health"><h2>Station Health Summary</h2><div className="grid three"><label>Station<select value={station} onChange={e=>setStation(e.target.value)}><option value="">All stations</option>{[...new Set(rows.map(r=>r.branch))].map(b=><option key={b}>{b}</option>)}</select></label><label>Health from date<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Health to date<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><div className="grid four form-space">{['Submitted','Draft','Missing','Check Required'].map(status=><div className="demo-metric" key={status}><small>{status==='Check Required'?'With an issue':status}</small><strong>{status==='Check Required'?issues:statuses.filter(s=>s===status).length}</strong></div>)}</div><p>Submitted reports stay marked Submitted. Any reason for checking appears below the status.</p><div className="table-wrap"><table className="station-reason-table"><thead><tr><th>Date</th><th>Station</th><th>Shift 1</th><th>Shift 2</th><th>Shift 3</th></tr></thead><tbody>{filtered.map(row=><tr key={row.date+row.branch}><td>{row.date}</td><td><b>{row.branch}</b></td>{row.shifts.map(({shift,status})=>{const report=reports[row.branch+'__'+row.date+'__'+shift.id];return <td key={shift.id}><StationHealthCell status={status} report={report}/></td>;})}</tr>)}</tbody></table></div>{!filtered.length&&<p>No reports in this date range.</p>}</section>;
}
