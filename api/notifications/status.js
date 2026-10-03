import { getRequestSession } from '../_shared/session.js';
import { supabaseAdmin } from '../_shared/supabase.js';
import { loadMissingReportAlerts } from '../_shared/report-alerts.js';
import { pushConfiguration } from '../_shared/push.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false});
  const auth=getRequestSession(req);
  if(!auth.ok||auth.session.role!=='Admin')return res.status(401).json({ok:false,error:'Admin login required.'});
  try{
    const alerts=await loadMissingReportAlerts(supabaseAdmin());
    return res.status(200).json({ok:true,alerts,checkedAt:new Date().toISOString(),push:pushConfiguration()});
  }catch{return res.status(503).json({ok:false,error:'Unable to verify missing reports. Please refresh or try again.'});}
}
