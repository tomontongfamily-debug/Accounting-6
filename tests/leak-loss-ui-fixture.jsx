import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FuelLeakLoss} from '../src/fuel-leak-loss.jsx';
import {PumpPhotoWorkflow} from '../src/upgrade-components.jsx';

function Scene() {
  const [report,setReport]=useState(window.__leakTestFixture);
  window.leakTestReport=report;window.setLeakTestReport=setReport;
  return <main style={{padding:'16px',maxWidth:'1100px'}}>
    <h1>Leak loss display test</h1><p>Test data only</p>
    <PumpPhotoWorkflow report={report} onReading={()=>{throw Error('Unexpected reading edit');}}/>
    <FuelLeakLoss report={report} onChange={rows=>setReport(old=>({...old,fuelLeakLosses:rows}))}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<Scene/>);
