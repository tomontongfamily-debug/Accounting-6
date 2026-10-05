import { useState } from 'react';

export function CorrectionDecisionActions({ approved, onApprove, onReject, mobile = false }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function decide(action, callback) {
    if (busy) return;
    setBusy(action);
    setError('');
    try {
      const result = await callback();
      if (result?.ok === false || result?.queued) throw new Error(result.error || 'The decision was not saved online. Please retry.');
    } catch (e) {
      setError(e.message || 'The decision was not saved online. Please retry.');
    } finally {
      setBusy('');
    }
  }
  return <div>
    <div className={mobile ? 'admin-mobile-correction-actions' : 'action-row'}>
      <button type="button" className={mobile ? 'approve' : 'small-success'} disabled={Boolean(busy) || approved} onClick={() => decide('approve', onApprove)}>
        {busy === 'approve' ? 'Saving approval…' : approved ? 'Approved' : 'Approve'}
      </button>
      <button type="button" className={mobile ? 'reject' : 'small-danger'} disabled={Boolean(busy)} onClick={() => decide('reject', onReject)}>
        {busy === 'reject' ? 'Saving rejection…' : 'Reject'}
      </button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
