const dayFormat = new Intl.DateTimeFormat('en-PH', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
const shiftTimes = {'shift-1':'4am–1pm', 'shift-2':'1pm–10pm', 'shift-3':'10pm–4am'};

function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0,10) === value;
}

export function depositDayLabel(value) {
  return validDay(value) ? dayFormat.format(new Date(`${value}T00:00:00Z`)) : 'Date unavailable';
}

// A deposit date is the bank visit date. Its coverage comes only from report keys.
export function depositCoverage(deposit, deposits = []) {
  const byId = new Map(deposits.map(row => [row.id, row]));
  const reports = new Map(), visited = new Set(), visiting = new Set();
  let incomplete = false;
  function collect(row) {
    if (visiting.has(row.id)) { incomplete = true; return; }
    if (visited.has(row.id)) return;
    visiting.add(row.id);
    for (const key of row.coveredReportKeys || []) {
      const match = /^(.*)__(\d{4}-\d{2}-\d{2})__(shift-[123])$/.exec(key);
      if (!match || match[1] !== deposit.branch || !validDay(match[2])) { incomplete = true; continue; }
      const [,branch,date,shiftId] = match;
      reports.set(key, {key, branch, date, shiftId, label:`${depositDayLabel(date)} · Shift ${shiftId.slice(-1)} · ${shiftTimes[shiftId]}`});
    }
    for (const id of row.carryoverSourceIds || []) {
      const source = byId.get(id);
      if (!source || source.branch !== deposit.branch) { incomplete = true; continue; }
      collect(source);
    }
    visiting.delete(row.id);
    visited.add(row.id);
  }
  collect(deposit);
  const ordered = [...reports.values()].sort((a,b) => a.date.localeCompare(b.date) || a.shiftId.localeCompare(b.shiftId));
  const dates = [...new Set(ordered.map(row => row.date))];
  const groups = dates.map(date => {
    const shifts = ordered.filter(row => row.date === date).map(row => row.shiftId);
    const shiftLabel = shifts.length === 1 ? `Shift ${shifts[0].slice(-1)} · ${shiftTimes[shifts[0]]}` : `Shifts ${shifts.map(id => id.slice(-1)).join(', ')}`;
    return {date, shiftLabel, label:`${depositDayLabel(date)} · ${shiftLabel}`};
  });
  return {
    title: dates.length > 1 ? `${depositDayLabel(dates[0])} – ${depositDayLabel(dates.at(-1))}` : dates.length ? depositDayLabel(dates[0]) : 'Covered shifts unavailable',
    groups, reports:ordered, incomplete,
    hasCarryover: !!deposit.carryoverSourceIds?.length,
  };
}
