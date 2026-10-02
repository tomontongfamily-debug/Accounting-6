import React, {useEffect,useState} from 'react';
export default function LiloanLaunchNotice(){
 const [config,setConfig]=useState(null);
 useEffect(()=>{let active=true;fetch('/api/pilot/config',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(value=>{if(active)setConfig(value);}).catch(()=>{});return()=>{active=false;};},[]);
 if(config?.mode!=='live')return null;
 const role=['cashier','manager','admin','approver'].find(value=>window.location.pathname.includes(value))||'cashier';
 return <aside style={{padding:'12px 20px',background:'#e6f5ed',color:'#143b28',textAlign:'center'}}><strong>Liloan: new system from {config.start_date}, 4:00 a.m.</strong> · <a href={'/pilot/'+role}>Open Liloan</a> · <a href="/liloan-guide.html">Station guide</a></aside>;
}
