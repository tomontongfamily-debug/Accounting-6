import {useId} from 'react';
import {isHighVariance,isHighShortage} from './error-reduction.ts';
import './high-variance-notice.css';

export function HighVarianceNotice({variance,onReviewCash,onReviewPumps,onReviewPayments}){
  const title=useId();
  if(!isHighVariance(variance))return null;
  return <section className="high-variance-notice" role="alert" aria-labelledby={title}>
    <div className="high-variance-heading"><span aria-hidden="true">!</span><div>
      <p>Report cannot be submitted</p><h2 id={title}>High variance</h2>
    </div></div>
    <strong>Please double-check</strong>
    <p>The recorded cash is {isHighShortage(variance)?'less':'more'} than expected. Review the cash count, pump readings, payments and deductions before submitting. Contact your manager if the difference remains.</p>
    {(onReviewCash||onReviewPumps||onReviewPayments)&&<div className="high-variance-actions">
      {onReviewCash&&<button type="button" onClick={onReviewCash}>Review cash count</button>}
      {onReviewPumps&&<button type="button" onClick={onReviewPumps}>Review pump readings</button>}
      {onReviewPayments&&<button type="button" onClick={onReviewPayments}>Review payments and deductions</button>}
    </div>}
  </section>;
}
