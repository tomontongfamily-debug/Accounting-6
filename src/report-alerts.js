// Start the new missing-report notifications without alerting on old rollout history.
export const REPORT_ALERT_START_DATE = '2026-10-03';
export const REPORT_ALERT_BRANCHES = ['Mabolo','Arpili','Liloan','Pondol','Barili','Moalboal'];
export function manilaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function nextDate(date) { return new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10); }
export function shiftEndsAt(date,shift) {
  return Date.parse(shift==='shift-3'?`${nextDate(date)}T04:00:00+08:00`:`${date}T${shift==='shift-1'?'13':'22'}:00:00+08:00`);
}
export function reportDeadlineAt(date,shift) { return shiftEndsAt(date,shift)+3600000; }
export function missingReportAlerts({reports=[],now=new Date(),startDate=REPORT_ALERT_START_DATE,branches=REPORT_ALERT_BRANCHES}={}) {
  const today=manilaDate(now), timestamp=now.getTime();
  const byKey=new Map(reports.map(r=>[`${r.branch}__${r.date||r.report_date}__${r.shiftId||r.shift_id}`,r]));
  const alerts=[];
  for(let date=startDate;date<=today;date=nextDate(date)) for(const branch of branches) {
    if(branch==='Liloan') {
      for(const shift of ['shift-1','shift-2','shift-3']) {
        const deadline=reportDeadlineAt(date,shift);
        if(deadline>timestamp)continue;
        const reportKey=`${branch}__${date}__${shift}`,r=byKey.get(reportKey);
        if(r?.confirmed===true||r?.baselineReport===true||r?.openingSetupComplete===true)continue;
        const due=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(deadline));
        alerts.push({id:`missing-report:${reportKey}`,kind:'shift-report-overdue',reportKey,branch,date,count:1,shifts:[shift],deadlineAt:new Date(deadline).toISOString(),
          message:`${branch} Shift ${shift.slice(-1)} report is overdue.`,
          detail:`Reporting date ${date}. Due ${due} Philippine time, one hour after shift end. Saved drafts do not count as submitted.`});
      }
      continue;
    }
    const shifts=['shift-1','shift-2','shift-3'].filter(shift=>{
      if(shiftEndsAt(date,shift)>timestamp)return false;
      const r=byKey.get(`${branch}__${date}__${shift}`);
      return !(r?.confirmed===true||r?.baselineReport===true||r?.openingSetupComplete===true);
    });
    if(shifts.length<2)continue;
    const shiftNames=shifts.map(s=>`Shift ${s.slice(-1)}`);
    alerts.push({id:`missing-reports:${branch}:${date}`,branch,date,count:shifts.length,shifts,
      message:`${branch} has not submitted ${shifts.length} reports.`,
      detail:`${date} · ${shiftNames.join(' and ')}. These shifts have ended; drafts are not submitted reports.`});
  }
  return alerts.sort((a,b)=>b.date.localeCompare(a.date)||a.branch.localeCompare(b.branch));
}
