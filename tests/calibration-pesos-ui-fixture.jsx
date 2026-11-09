import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createReport,compute} from '../src/accounting-engine.js';
import {calibrationPesoEntry} from '../src/fuel-leak-loss.js';
import {ReturnedCalibration} from '../src/returned-calibration.jsx';

function CalibrationFixture() {
 const [report,setReport]=useState(()=>{
  const initial=createReport('Liloan','2026-11-06',{Premium:80,Regular:50,Diesel:70},'shift-1');
  initial.pumpRows.forEach(row=>Object.assign(row,{opening:1000,closing:1000}));
  initial.pumpRows.find(row=>row.product==='Regular').closing=1100;
  return initial;
 });
 return <main><ReturnedCalibration report={report} onChange={(index,value)=>setReport(old=>({...old,tankRows:old.tankRows.map((row,i)=>i===index?calibrationPesoEntry(row,value):row)}))} />
  <output aria-label="Calibration expected cash">{compute(report).expectedCash.toFixed(2)}</output>
  <button onClick={()=>setReport(old=>({...old,confirmed:true}))}>Show submitted report</button>
 </main>;
}
createRoot(document.getElementById('root')).render(<CalibrationFixture />);
