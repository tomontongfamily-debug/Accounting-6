import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { loadPilotConfiguration } from './pilot-config.js';
const Pilot=lazy(()=>import('./PilotApp.jsx'));
export default function PilotGate() {
  const [config,setConfig]=useState(null),[error,setError]=useState('');
  const [checking,setChecking]=useState(false),checkRef=useRef(null);
  useEffect(()=>{
    let active=true,pending=false,controller,timer;
    const check=async(background=false)=>{
      if(pending)return;
      clearTimeout(timer);
      if(background&&document.visibilityState==='hidden'){timer=setTimeout(reconnect,15000);return;}
      pending=true;controller=new AbortController();setChecking(true);
      try {
        const value=await loadPilotConfiguration({signal:controller.signal});
        if(active){window.__fueltechPilotConfig=value;setConfig(value);setError('');}
      }catch(e){if(active)setError(e.message);}
      finally{pending=false;if(active){setChecking(false);timer=setTimeout(reconnect,15000);}}
    };
    const reconnect=()=>{void check(true);};
    checkRef.current=check;
    void check();
    window.addEventListener('focus',reconnect);
    window.addEventListener('online',reconnect);
    document.addEventListener('visibilitychange',reconnect);
    return()=>{
      active=false;controller?.abort();clearTimeout(timer);
      window.removeEventListener('focus',reconnect);
      window.removeEventListener('online',reconnect);
      document.removeEventListener('visibilitychange',reconnect);
      if(checkRef.current===check)checkRef.current=null;
    };
  },[]);
  const retry=<button type="button" disabled={checking} onClick={()=>checkRef.current?.()}>{checking?'Checking connection…':'Retry connection'}</button>;
  const warning=error&&<aside role="status" className="section"><p>Connection check delayed. Your current screen remains open.</p>{retry}</aside>;
  if(config?.mode==='disabled') return <main className="section"><h1>FuelTech Accounting</h1><p>The pilot has not been enabled yet. Existing station reports remain available in the regular app.</p><a href="/">Open existing app</a></main>;
  if(!config&&error)return <main className="section"><h1>FuelTech Accounting</h1><p role="alert">{error}</p>{retry}<p><a href="/">Open existing app</a></p></main>;
  if(!config) return <p>Checking pilot configuration…</p>;
  if(config.mode==='live'&&config.launch&&!config.launch.ready) return <main className="section" style={{maxWidth:680,margin:'40px auto',padding:24}}>{warning}<h1>Liloan fresh start</h1><p>The new system starts <strong>{config.start_date} at 4:00 a.m.</strong> Manila time.</p><h2>Opening setup</h2><p>Finish and submit <strong>{config.launch.openingDate} Shift 3</strong> in the existing app. Its final pump readings and tank inventory become the new opening balances.</p><p>{config.launch.openingReady?'Shift 3 opening readings are ready.':'Waiting for complete, submitted Shift 3 readings.'} {!config.launch.timeReached?'New shift reporting will unlock at the start time.':''}</p><p>This screen checks automatically every 15 seconds.</p><p><a href="/cashier">Complete Shift 3 in the existing app</a></p><p><a href="/liloan-guide.html">Read the simple station guide</a></p></main>;
  return <>{warning}{config.mode==='shadow'&&<aside className="demo-banner"><div><strong>FUELTECH · ACCOUNTING TRIAL</strong><span>Trial records are separate from official reports. · From {config.start_date}</span></div><nav>{['cashier','manager','approver','admin'].map(role=><a key={role} href={'/pilot/'+role}>{role==='approver'?'Bank Verifier':role}</a>)}</nav></aside>}<Suspense fallback={<p>Loading station…</p>}><Pilot/></Suspense></>;
}
