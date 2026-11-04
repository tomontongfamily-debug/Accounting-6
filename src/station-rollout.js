export const ALL_STATIONS = ['Mabolo','Arpili','Liloan','Pondol','Barili','Moalboal'];
export const ROLLOUT_VERSION = 'all-stations-2026-11-04-shift-3';
export const ROLLOUT_REPORTING_DATE = '2026-11-05';

export function configuredStations(config) {
  return Array.isArray(config?.branches) ? config.branches : ['Liloan'];
}

export function stationStartDate(config, branch) {
  return config?.stationStarts?.[branch] || config?.start_date || config?.startDate;
}

export function withStationRollout(config) {
  if (config.mode !== 'live' || config.start_date !== '2026-10-03') return config;
  return {...config, rolloutVersion: ROLLOUT_VERSION, branches: ALL_STATIONS,
    stationStarts: Object.fromEntries(ALL_STATIONS.map(branch => [branch, branch === 'Liloan' ? config.start_date : ROLLOUT_REPORTING_DATE]))};
}

export function stationOpeningSlot(config, branch = 'Liloan') {
  const date = stationStartDate(config, branch);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid station start date');
  const day = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date) throw Error('Invalid station start date');
  day.setUTCDate(day.getUTCDate()-1);
  return {date: day.toISOString().slice(0,10), shiftId: 'shift-3'};
}

export function isStationOpening(config, report) {
  const slot = stationOpeningSlot(config, report.branch);
  return report.date === slot.date && report.shiftId === slot.shiftId;
}
