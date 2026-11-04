import { getRequestSession } from '../_shared/session.js';
import { supabaseAdmin } from '../_shared/supabase.js';
import { loadMissingReportAlerts } from '../_shared/report-alerts.js';
import { pushConfiguration } from '../_shared/push.js';
import { notificationAudience } from '../_shared/notification-access.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false});
  const auth=getRequestSession(req);
  const audience=auth.ok&&notificationAudience(auth.session);
  if(!audience)return res.status(401).json({ok:false,error:'Admin or Liloan manager login required.'});
  try{
    const alerts=await loadMissingReportAlerts(supabaseAdmin(),new Date(),audience.role==='Manager'?{branches:[audience.branch]}:{});
    return res.status(200).json({ok:true,alerts,checkedAt:new Date().toISOString(),push:pushConfiguration()});
  }catch{return res.status(503).json({ok:false,error:'Unable to verify missing reports. Please refresh or try again.'});}
}
