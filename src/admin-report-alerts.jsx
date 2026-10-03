import {useCallback,useEffect,useState} from 'react';
import './admin-report-alerts.css';

async function notificationApi(path,body,token){
  // Notifications use the shared, admin-authenticated service in both app routes.
  const r=await fetch('/api/notifications/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token&&token!=='cookie'?{'x-fueltech-session':token}:{})},body:JSON.stringify(body)});
  const value=await r.json();if(!r.ok||!value.ok)throw Error(value.error||'Unable to connect to phone alerts.');return value;
}
function keyBytes(value){const raw=atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'='));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function sameKey(subscription,key){const actual=subscription.options?.applicationServerKey;return actual&&new Uint8Array(actual).every((v,i)=>v===key[i])&&actual.byteLength===key.length;}
function supported(){return 'serviceWorker' in navigator&&'PushManager' in window&&typeof Notification!=='undefined';}
function unsupportedMessage(){return /iPad|iPhone|iPod/.test(navigator.userAgent)?'On iPhone, add this Admin app to your Home Screen, open it there, then enable alerts.':'Phone push is unavailable in this browser. Missing-report flags still appear here.';}

export default function AdminReportAlerts({sessionToken,compact=false,onShowAll}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[enabled,setEnabled]=useState(false);
  const refresh=useCallback(async()=>{try{const next=await notificationApi('status',{},sessionToken);setData(next);setError('');return next;}catch(e){setError(e.message);return null;}},[sessionToken]);
  useEffect(()=>{let active=true;refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},60000);const focus=()=>refresh();window.addEventListener('focus',focus);
    async function reconnect(){
      if(!supported()){if(active)setStatus(unsupportedMessage());return;}
      if(Notification.permission==='denied'){if(active)setStatus('Notifications are blocked. Allow them in this phone’s browser settings.');return;}
      try{const registration=await navigator.serviceWorker.getRegistration('/');const sub=await registration?.pushManager.getSubscription();if(!sub)return;
        const cfg=await notificationApi('subscribe',{action:'config'},sessionToken);
        if(!sameKey(sub,keyBytes(cfg.publicKey))){if(active)setStatus('Enable alerts again to reconnect this phone.');return;}
        await notificationApi('subscribe',{action:'subscribe',subscription:sub.toJSON()},sessionToken);
        if(active){setEnabled(true);setStatus('This phone is registered for missing-report and correction alerts.');}
      }catch(e){if(active){setEnabled(false);setStatus(e.message);}}
    }reconnect();return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus);};
  },[refresh,sessionToken]);
  async function enable(){
    if(!supported()){setStatus(unsupportedMessage());return;}
    setBusy(true);setEnabled(false);setStatus('Connecting phone alerts…');
    try{
      if(await Notification.requestPermission()!=='granted')throw Error('Allow notifications in this phone’s browser settings, then try again.');
      const registration=await navigator.serviceWorker.register('/fueltech-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
      const cfg=await notificationApi('subscribe',{action:'config'},sessionToken),key=keyBytes(cfg.publicKey);
      let sub=await registration.pushManager.getSubscription();if(sub&&!sameKey(sub,key)){await sub.unsubscribe();sub=null;}
      sub??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await notificationApi('subscribe',{action:'subscribe',subscription:sub.toJSON()},sessionToken);
      setEnabled(true);setStatus('Alerts enabled. Use Send test alert to check delivery to this phone.');
    }catch(e){setStatus(e.message||'Unable to enable phone alerts.');}finally{setBusy(false);}
  }
  async function test(){setBusy(true);try{const registration=await navigator.serviceWorker.getRegistration('/'),sub=await registration?.pushManager.getSubscription();if(!sub)throw Error('Enable alerts on this phone first.');await notificationApi('subscribe',{action:'test',endpoint:sub.endpoint},sessionToken);setStatus('Test accepted by the push service. Check your phone’s notifications.');}catch(e){setEnabled(false);setStatus(e.message);}finally{setBusy(false);}}
  const alerts=data?.alerts||[],visible=compact?alerts.slice(0,3):alerts;
  return <section className="admin-report-alerts" aria-label="Missing cashier reports">
    <div className="report-alert-heading"><h2>Missing reports</h2><span>{alerts.length?`${alerts.length} station/date alert${alerts.length===1?'':'s'}`:'Shift checks'}</span></div>
    <p>Flags a station when 2 or more ended shifts on a reporting date are still unsubmitted.</p>
    {error?<p className="report-alert-error" role="alert">{error} <button type="button" onClick={refresh}>Retry</button></p>:!data?<p>Checking saved reports…</p>:<>
      {!alerts.length&&<p className="report-alert-clear">No station has two completed shift reports missing.</p>}
      {visible.map(alert=><article className="missing-report-card" key={alert.id}><strong>{alert.message}</strong><p>{alert.detail}</p></article>)}
      {compact&&alerts.length>3&&<button type="button" onClick={onShowAll}>Show all {alerts.length} alerts</button>}
      <small>Checked {new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(new Date(data.checkedAt))} · Philippine time</small>
    </>}
    <div className="report-alert-phone"><div><b>Phone notifications</b><p role="status">{status||(!data?.push.ready&&data?'Phone delivery is not configured. Missing-report flags still work here.':'Enable once on each phone to receive missing-report and correction alerts.')}</p></div><div className="report-alert-buttons"><button type="button" disabled={busy} onClick={enable}>{busy?'Please wait…':enabled?'Reconnect alerts':'Enable Alerts'}</button>{enabled&&<button type="button" disabled={busy} onClick={test}>Send test alert</button>}</div></div>
  </section>;
}
