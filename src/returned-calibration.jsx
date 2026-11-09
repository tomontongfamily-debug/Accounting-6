import {calibrationAmount,returnedCalibrationSummary,validateReturnedCalibration} from './fuel-leak-loss.js';

const pesos=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value);

export function ReturnedCalibration({report,onChange}) {
  const summaries=returnedCalibrationSummary(report),error=validateReturnedCalibration(report);
  return <section className="section calibration-section" aria-label="Calibration amount">
    <h3>Calibration amount — pesos</h3>
    <p>Enter the peso amount shown by the pump for calibration fuel returned to the tank. This reduces fuel sales and expected cash once. Enter 0 when there was no calibration.</p>
    <div className="grid three">{(report.tankRows||[]).map((row,index)=>{
      const summary=summaries.find(item=>item.product===row.product);
      const value=row.calibrationUnit==='PHP'?(row.calibration??0):Number(calibrationAmount(report,row).toFixed(2));
      const otherAmount=summary.amount-calibrationAmount(report,row);
      return <label key={row.id}>{row.product} calibration (PHP)
        <span className="calibration-peso-input">
          <span aria-hidden="true">₱</span>
          <input aria-label={`${row.product} calibration amount in pesos`} type="number" inputMode="decimal" min="0" max={Math.max(0,summary.availableSales-otherAmount).toFixed(2)} step="0.01" value={value} disabled={report.confirmed||!onChange} onChange={event=>onChange(index,event.target.value)} />
        </span>
        <small>Available fuel sales: {pesos(Math.max(0,summary.availableSales))}</small>
        <small>{row.product} calibration adjustment: −{pesos(summary.salesAdjustment)}</small>
      </label>;
    })}</div>
    {report.managerReconciliation&&<p className="neutral">This historical report also has an approved manual sales reconciliation. Its original entries remain preserved.</p>}
    {error&&<p className="error" role="alert">{error} Check the calibration entry before saving or submitting.</p>}
  </section>;
}
