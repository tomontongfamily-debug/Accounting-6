import { useCallback, useEffect, useRef, useState } from 'react';
import { demoApi, PumpPhotoWorkflow, MidShiftPhotoReadings, savePumpReading } from './upgrade-components.jsx';
import {midShiftPumpKey,midShiftPhotoRow,midShiftReadingComplete,pendingPricePhotoChanges} from './mid-shift-price-change.js';
import { readingComplete } from './error-reduction.ts';
import { mergePhoneReadings } from './phone-reading-sync.js';
export { usePhoneView } from './phone-view.js';

const keyOf=r=>`${r.branch}__${r.date}__${r.shiftId}`;

export function MobilePumpCapture({branch,reports,initialDate,logout,correctionPanel}) {
  const choices=Object.values(reports).filter(r=>r.branch===branch&&(r.baselineReport||r.date>=window.__fueltechPilotConfig.start_date)&&(!r.baselineMissing||r.baselineReport)).sort((a,b)=>keyOf(b).localeCompare(keyOf(a)));
  const approvedCorrections=choices.filter(r=>!r.confirmed&&r.correctionRequest?.status==='approved'&&Date.parse(r.correctionRequest.expiresAt||'')>Date.now());
  const [selected,setSelected]=useState(()=>{
    const preferred=choices.find(r=>r.baselineReport&&!r.confirmed)||approvedCorrections[0]||choices.filter(r=>r.date===initialDate&&!r.confirmed).sort((a,b)=>a.shiftId.localeCompare(b.shiftId))[0]||choices.find(r=>!r.confirmed)||choices[0];
    return preferred?keyOf(preferred):'';
  });
  const [report,setReport]=useState(null);
  const [task,setTask]=useState('');
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
    setReport(null);setTask('');setError('');setMessage('Loading pump readings…');
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
  const priceChanges=report&&!report.baselineReport?pendingPricePhotoChanges(report):[];
  const preferredTask=priceChanges.find(change=>report.pumpRows.some(row=>row.product===change.product&&!midShiftReadingComplete(report,change,row)))?.id||'closing';
  const currentTask=task||preferredTask;
  const change=priceChanges.find(item=>item.id===currentTask);
  async function save(row,savedPhoto,options) {
    const version=generation.current;
    mutations.current+=1;
    const result=savedPhoto||await savePumpReading(report,row,options);
    if(version===generation.current){setReport(current=>mergePhoneReadings(current,result.report)||result.report);setMessage(savedPhoto?'Photo saved. Automatic reading continues; you can photograph the next pump.':row.readingConfirmed?'Reading confirmed and saved. It will appear on the desktop automatically.':'Photo saved. Check and confirm the reading.');setError('');}
    return result.report.pumpRows.find(r=>r.id===row.id);
  }
  async function savePriceReading(priceChange,row,savedPhoto,options){
    const version=generation.current;
    setTask(priceChange.id);mutations.current+=1;
    const result=savedPhoto||await demoApi('midshift-reading',{reportKey:selected,changeId:priceChange.id,product:priceChange.product,effectiveTime:priceChange.effectiveTime,row,revision:row.readingRevision||0},options);
    if(version===generation.current){setReport(current=>mergePhoneReadings(current,result.report)||result.report);setMessage(row.readingConfirmed?'Price-change reading confirmed and saved.':'Price-change photo saved. Check and confirm the number.');setError('');}
    const savedChange=result.report.midShiftPriceChanges.find(item=>item.id===priceChange.id);
    const savedRow=result.report.pumpRows.find(item=>midShiftPumpKey(item)===midShiftPumpKey(row));
    return midShiftPhotoRow(savedChange,savedRow,result.report);
  }
  const done=report?.pumpRows.filter(readingComplete).length||0;
  return <main className="app mobile-pump-app"><div className="container">
    <header className="phone-pump-header"><div><small>FUELTECH · CASHIER</small><h1>Pump photos</h1><strong>{branch}</strong></div><button type="button" className="secondary" disabled={busy} onClick={logout}>Log out</button></header>
    <fieldset className="phone-correction-request" disabled={busy}>{correctionPanel}</fieldset>
    {approvedCorrections.map(r=><div className="warning-box" key={keyOf(r)}><strong>Approved correction · {r.date} · {r.shiftId.replace('shift-','Shift ')}</strong><p>Replace the incorrect pump photo and confirm its reading. Finish the report on the desktop.</p><button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(keyOf(r))}>Open approved correction</button></div>)}
    <label className="phone-shift-picker">Shift to photograph<select aria-label="Shift to photograph" value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{choices.map(r=><option key={keyOf(r)} value={keyOf(r)}>{r.baselineReport?'Opening Setup · ':''}{r.date} · {r.shiftId.replace('shift-','Shift ')}{r.confirmed?' · Submitted':approvedCorrections.includes(r)?' · Approved correction':''}</option>)}</select></label>
    <p>{report?.baselineReport?'Take the starting pump photos here. Enter tank stock and Coke inventory, then confirm Opening Setup on the desktop.':'Take the pump photos here. Finish cash count and the rest of the report on the desktop.'}</p>
    {error?<p className="error" role="alert">{error} Reconnect or refresh before continuing.</p>:<p role="status">{message}</p>}
    {!choices.length&&<p>No opening setup or shifts are available. Open the station dashboard on the desktop, then refresh this page.</p>}
    {report&&<>{priceChanges.length>0&&<><label className="phone-shift-picker">Photos for<select aria-label="Photos for" disabled={busy} value={change?.id||'closing'} onChange={event=>setTask(event.target.value)}>{priceChanges.map(item=><option key={item.id} value={item.id}>{item.product} price change · {item.effectiveTime}</option>)}<option value="closing">Shift closing readings</option></select></label><p className="warning-box">Price-change photos and shift closing photos are separate. For a price change, use the photos taken at that change time. The manager must confirm the price after all affected nozzle readings are saved.</p></>}
    {change?<section className="section"><h2>{change.product} price change · {change.effectiveTime}</h2><MidShiftPhotoReadings key={selected+'__'+change.id+'__'+change.product+'__'+change.effectiveTime} report={report} change={change} onReading={savePriceReading} onBusy={onBusy}/></section>:<PumpPhotoWorkflow key={selected} report={report} onReading={save} onBusy={onBusy}/>}
    {report.confirmed?<p className="success-box">This report is submitted and locked.</p>:!change&&done===report.pumpRows.length&&<p className="success-box">All closing pump readings are confirmed and saved. Continue the report on the desktop.</p>}</>}
  </div></main>;
}
