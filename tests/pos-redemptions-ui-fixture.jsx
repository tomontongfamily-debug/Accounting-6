import React,{useState} from 'react';
import { createRoot } from 'react-dom/client';
import { PosRedemptions } from '../src/pos-redemptions.jsx';
function Scene(){
  const [report,setReport]=useState(window.__posFixture);
  return <main style={{padding:16,maxWidth:1100,fontFamily:'Arial,sans-serif'}}><h1>Liloan redemption comparison</h1><p>Test data only</p><PosRedemptions report={report}/><button onClick={()=>setReport(r=>({...r,posRedemptions:{...r.posRedemptions,status:'unavailable'}}))}>Simulate unavailable POS</button><button onClick={()=>setReport(r=>({...r,posRedemptions:{...r.posRedemptions,status:'unavailable',verifiedAt:''}}))}>Simulate no verified copy</button></main>;
}
createRoot(document.getElementById('root')).render(<Scene/>);
