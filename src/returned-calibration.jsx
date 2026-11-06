import {returnedCalibrationSummary,validateReturnedCalibration} from './fuel-leak-loss.js';

const liters=value=>Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:3});
const pesos=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value);

export function ReturnedCalibration({report,onChange}) {
  const summaries=returnedCalibrationSummary(report),error=validateReturnedCalibration(report);
  return <section className="section" aria-label="Returned calibration">
    <h3>Returned calibration — litres</h3>
    <p>Enter the total calibrated litres returned to the tank during this shift. Add all test buckets together; calibrated litres and returned litres are the same amount. Record the total once. This reduces calculated sales and expected cash. Enter litres, not pesos. Leave 0 when there was no calibration.</p>
    <div className="grid three">{(report.tankRows||[]).map((row,index)=>{
      const summary=summaries.find(item=>item.product===row.product);
      const otherLiters=summary.calibrationLiters-Math.max(0,Number(row.calibration)||0);
      return <label key={row.id}>{row.product} returned calibration (L)
        <input aria-label={`${row.product} returned calibration (L)`} type="number" inputMode="decimal" min="0" max={Math.max(0,summary.availableLiters-otherLiters)} step="0.001" value={row.calibration??0} disabled={report.confirmed||!onChange} onChange={event=>onChange(index,event.target.value)} />
        <small>Pump volume: {liters(summary.meteredLiters)} L · Available after metered leaks: {liters(summary.availableLiters)} L</small>
        <small>{row.product} pump-sales adjustment: −{pesos(summary.salesAdjustment)}</small>
      </label>;
    })}</div>
    {report.managerReconciliation&&<p className="neutral">This historical report also has an approved manual sales reconciliation. Its original entries remain preserved.</p>}
    {error&&<p className="error" role="alert">{error} Check the calibration entry before saving or submitting.</p>}
  </section>;
}
