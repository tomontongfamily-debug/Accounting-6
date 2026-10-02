import { useCallback, useEffect, useRef, useState } from 'react';
import { demoApi, PumpPhotoWorkflow, savePumpReading } from './upgrade-components.jsx';
import { readingComplete } from './error-reduction.ts';

const keyOf=r=>`${r.branch}__${r.date}__${r.shiftId}`;
export function usePhoneView() {
  const [phone,setPhone]=useState(()=>window.matchMedia('(max-width: 767px)').matches);
  useEffect(()=>{
    const query=window.matchMedia('(max-width: 767px)');
    const change=()=>setPhone(query.matches);
    query.addEventListener('change',change);
    return()=>query.removeEventListener('change',change);
  },[]);
  return phone;
}

export function MobilePumpCapture({branch,reports,initialDate,logout}) {
  const choices=Object.values(reports).filter(r=>r.branch===branch&&r.date>=window.__fueltechPilotConfig.start_date&&!r.baselineReport&&!r.baselineMissing).sort((a,b)=>keyOf(b).localeCompare(keyOf(a)));
  const [selected,setSelected]=useState(()=>{
    const preferred=choices.filter(r=>r.date===initialDate&&!r.confirmed).sort((a,b)=>a.shiftId.localeCompare(b.shiftId))[0]||choices.find(r=>!r.confirmed)||choices[0];
    return preferred?keyOf(preferred):'';
  });
  const [report,setReport]=useState(null);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('Loading pump readings…');
  const [busyRows,setBusyRows]=useState({});
  const busy=Object.values(busyRows).some(Boolean);
  const busyRef=useRef(false);
  busyRef.current=busy;
  const onBusy=useCallback((id,value)=>setBusyRows(old=>({...old,[id]:value})),[]);
  const generation=useRef(0);
  const mutations=useRef(0);
  useEffect(()=>{
    let mounted=true,inFlight=false;
    const version=++generation.current;
    setReport(null);setError('');setMessage('Loading pump readings…');
    async function refresh() {
      if(!selected||busyRef.current||inFlight||document.hidden)return;
      inFlight=true;
      const mutation=mutations.current;
      try {
        const result=await demoApi('pump-report',{reportKey:selected});
        if(mounted&&version===generation.current&&mutation===mutations.current&&!busyRef.current){setReport(result.report);setError('');setMessage('Connected · Confirmed readings are saved to this shift.');}
      } catch(e){if(mounted)setError(e.message);}
      finally{inFlight=false;}
    }
    refresh();
    const timer=window.setInterval(refresh,15000);
    window.addEventListener('online',refresh);
    window.addEventListener('focus',refresh);
    return()=>{mounted=false;window.clearInterval(timer);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);};
  },[selected]);
  async function save(row) {
    const version=generation.current;
    mutations.current+=1;
    const result=await savePumpReading(report,row);
    if(version===generation.current){setReport(result.report);setMessage(row.readingConfirmed?'Reading confirmed and saved. It will appear on the desktop automatically.':'Photo saved. Check and confirm the reading.');setError('');}
    return result.report.pumpRows.find(r=>r.id===row.id);
  }
  const done=report?.pumpRows.filter(readingComplete).length||0;
  return <main className="app mobile-pump-app"><div className="container">
    <header className="phone-pump-header"><div><small>FUELTECH · CASHIER</small><h1>Pump photos</h1><strong>{branch}</strong></div><button type="button" className="secondary" disabled={busy} onClick={logout}>Log out</button></header>
    <label className="phone-shift-picker">Shift to photograph<select aria-label="Shift to photograph" value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{choices.map(r=><option key={keyOf(r)} value={keyOf(r)}>{r.date} · {r.shiftId.replace('shift-','Shift ')}{r.confirmed?' · Submitted':''}</option>)}</select></label>
    <p>Take the pump photos here. Finish cash count and the rest of the report on the desktop.</p>
    {error?<p className="error" role="alert">{error} Reconnect or refresh before continuing.</p>:<p role="status">{message}</p>}
    {!choices.length&&<p>No shifts are available. Complete station opening setup on the desktop first.</p>}
    {report&&<><PumpPhotoWorkflow key={selected} report={report} onReading={save} onBusy={onBusy}/>{report.confirmed?<p className="success-box">This report is submitted and locked.</p>:done===report.pumpRows.length&&<p className="success-box">All pump readings are confirmed and saved. Continue the report on the desktop.</p>}</>}
  </div></main>;
}
