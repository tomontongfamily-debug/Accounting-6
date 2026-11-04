import {supabaseAdmin} from './supabase.js';
import {loadMissingReportAlerts} from './report-alerts.js';
import {sendMissingReportNotifications} from './push.js';

export async function reportAlertsHandler(req,res,{branches}={}) {
  if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
  if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return res.status(401).json({ok:false,error:'Unauthorized'});
  try {
    const db=supabaseAdmin(),alerts=await loadMissingReportAlerts(db,new Date(),{branches});
    const result=await sendMissingReportNotifications(db,alerts);
    return res.status(result.disabled||result.failed?503:200).json({ok:!result.disabled&&!result.failed,missingReportAlerts:alerts.length,...result});
  } catch { return res.status(500).json({ok:false,error:'Missing-report notification check failed.'}); }
}
