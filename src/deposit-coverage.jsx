import { depositCoverage } from './deposit-coverage.js';

export function DepositCoverageLines({deposit, deposits}) {
  const coverage = depositCoverage(deposit, deposits);
  return <span className="deposit-covered-shifts">
    {coverage.groups.map(group => <span key={group.date}>{coverage.groups.length === 1 ? group.shiftLabel : group.label}</span>)}
    {coverage.hasCarryover && <small>Includes remaining cash from earlier shifts</small>}
    {coverage.incomplete && <small>Some covered shifts are unavailable</small>}
  </span>;
}
