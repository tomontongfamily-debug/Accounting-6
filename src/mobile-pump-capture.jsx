import { useCallback, useEffect, useRef, useState } from 'react';
import { demoApi, CashConfirmation, PumpPhotoWorkflow, savePumpReading } from './upgrade-components.jsx';
import { readingComplete } from './error-reduction.ts';
import { needsCashEntry, withCashEntryDraft, readCashEntryDraft, saveCashEntryDraft, clearCashEntryDraft } from './cash-first-workflow.js';

const keyOf=r=>`${r.branch}__${r.date}__${r.shiftId}`;
const cashStorage=()=>{try{return window.localStorage;}catch{return null;}};
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

export function MobilePumpCapture({branch,reports,initialDate,logout,onSaved}) {
  const choices=Object.values(reports).filter(r=>r.branch===branch&&r.date>=window.__fueltechPilotConfig.start_date&&!r.baselineReport&&!r.baselineMissing).sort((a,b)=>keyOf(b).localeCompare(keyOf(a)));
  const approvedCorrections=choices.filter(r=>!r.confirmed&&r.correctionRequest?.status==='approved'&&Date.parse(r.correctionRequest.expiresAt||'')>Date.now());
  const [selected,setSelected]=useState(()=>{
    const preferred=approvedCorrections[0]||choices.filter(r=>r.date===initialDate&&!r.confirmed).sort((a,b)=>a.shiftId.localeCompare(b.shiftId))[0]||choices.find(r=>!r.confirmed)||choices[0];
    return preferred?keyOf(preferred):'';
  });
  const [loadedReport,setReport]=useState(null);
  const report=loadedReport&&keyOf(loadedReport)===selected?loadedReport:null;
  const [error,setError]=useState('');
  const [message,setMessage]=useState('Loading shift…');
  const [busyRows,setBusyRows]=useState({});
  const [cashBusy,setCashBusy]=useState(false);
  const [cashDrafts,setCashDrafts]=useState({});
  const busy=Object.values(busyRows).some(Boolean)||cashBusy;
  const busyRef=useRef(false);
  busyRef.current=busy;
  const onBusy=useCallback((id,value)=>setBusyRows(old=>({...old,[id]:value})),[]);
  const generation=useRef(0);
  const mutations=useRef(0);
  const onCashBusy=useCallback(value=>{if(value){mutations.current+=1;busyRef.current=true;}setCashBusy(value);},[]);
  useEffect(()=>{
    let mounted=true,inFlight=false;
    const version=++generation.current;
    setReport(null);setError('');setMessage('Loading shift…');
    async function refresh() {
      if(!selected||busyRef.current||inFlight||document.hidden)return;
      inFlight=true;
      const mutation=mutations.current;
      try {
        const result=await demoApi('pump-report',{reportKey:selected});
        if(mounted&&version===generation.current&&mutation===mutations.current&&!busyRef.current){setReport(result.report);setError('');setMessage('Connected · Confirmed entries are saved to this shift.');if(result.report.cashCountConfirmed||result.report.confirmed){clearCashEntryDraft(cashStorage(),window.__fueltechPilotConfig,result.report);setCashDrafts(old=>{if(!Object.hasOwn(old,selected))return old;const next={...old};delete next[selected];return next;});}}
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
  function updateCashCounts(counts) {
    setCashDrafts(old=>({...old,[selected]:counts}));
    saveCashEntryDraft(cashStorage(),window.__fueltechPilotConfig,report,counts);
  }
  function acceptCash(saved) {
    mutations.current+=1;
    setReport(saved);setError('');setMessage('Cash on Hand saved. Continue with pump photos.');
    clearCashEntryDraft(cashStorage(),window.__fueltechPilotConfig,saved);
    setCashDrafts(old=>{const next={...old};delete next[selected];return next;});
    onSaved?.(saved);
  }
  async function reloadCash(counts) {
    const version=generation.current;
    mutations.current+=1;
    const result=await demoApi('pump-report',{reportKey:selected});
    if(version!==generation.current)return;
    setReport(result.report);
    if(needsCashEntry(result.report)&&counts!==null){setCashDrafts(old=>({...old,[selected]:counts}));saveCashEntryDraft(cashStorage(),window.__fueltechPilotConfig,result.report,counts);}
    else clearCashEntryDraft(cashStorage(),window.__fueltechPilotConfig,result.report);
  }
  const cashFirst=needsCashEntry(report);
  const cashReport=report?withCashEntryDraft(report,cashDrafts[selected]??readCashEntryDraft(cashStorage(),window.__fueltechPilotConfig,report)):null;
  const done=report?.pumpRows.filter(readingComplete).length||0;
  return <main className="app mobile-pump-app"><div className="container">
    <header className="phone-pump-header"><div><small>FUELTECH · CASHIER</small><h1>{cashFirst?'Cash on Hand':report?'Pump photos':'Shift report'}</h1><strong>{branch}</strong></div><button type="button" className="secondary" disabled={busy} onClick={logout}>Log out</button></header>
    {approvedCorrections.map(r=><div className="warning-box" key={keyOf(r)}><strong>Approved correction · {r.date} · {r.shiftId.replace('shift-','Shift ')}</strong><p>Replace the incorrect pump photo and confirm its reading. Finish the report on the desktop.</p><button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(keyOf(r))}>Open approved correction</button></div>)}
    <label className="phone-shift-picker">Report shift<select aria-label="Report shift" value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{choices.map(r=><option key={keyOf(r)} value={keyOf(r)}>{r.date} · {r.shiftId.replace('shift-','Shift ')}{r.confirmed?' · Submitted':approvedCorrections.includes(r)?' · Approved correction':''}</option>)}</select></label>
    <p>Step 1: enter Cash on Hand. Step 2: take pump photos. Finish the remaining report on the desktop.</p>
    {error?<p className="error" role="alert">{error} Reconnect or refresh before continuing.</p>:<p role="status">{message}</p>}
    {!choices.length&&<p>No shifts are available. Complete station opening setup on the desktop first.</p>}
    {report&&(cashFirst?<section className="section"><h2>Step 1 · Cash on Hand</h2><p>Enter the notes and coins physically on hand for this shift, then confirm before taking pump photos.</p><CashConfirmation key={selected} report={cashReport} onSaved={acceptCash} onCountsChange={updateCashCounts} onReload={reloadCash} onBusy={onCashBusy}/></section>:<>{report.cashCountConfirmed&&<p className="success-box">Cash on Hand is confirmed.</p>}<h2>Step 2 · Pump photos</h2><PumpPhotoWorkflow key={selected} report={report} onReading={save} onBusy={onBusy}/>{report.confirmed?<p className="success-box">This report is submitted and locked.</p>:done===report.pumpRows.length&&<p className="success-box">All pump readings are confirmed and saved. Continue the report on the desktop.</p>}</>)}
  </div></main>;
}
