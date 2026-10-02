import { createClient } from '@supabase/supabase-js';
import { getRequestSession } from '../_shared/session.js';
import { configuration,pilotDatabase,BUCKET } from '../../pilot/repository.mjs';
import { accountingTiming,dateOffset,loadSources } from '../../pilot/integrations.mjs';
import { BACKUP_BUCKET } from '../../pilot/backup.mjs';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false});
  const auth=getRequestSession(req);
  if(!auth.ok||auth.session.role!=='Admin') return res.status(403).json({ok:false});
  try {
    const db=pilotDatabase(),config=await configuration(db),today=accountingTiming(new Date().toISOString()).date;
    if(!process.env.FUELTECH_CV_URL||!process.env.FUELTECH_CV_SERVICE_ROLE_KEY) throw Error('CV server connection is missing.');
    const cv=createClient(process.env.FUELTECH_CV_URL,process.env.FUELTECH_CV_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const [sources,reports,backup,bucket,offProjectBucket]=await Promise.all([
      loadSources(db,cv,dateOffset(today,-7),today),
      db.from('fueltech_reports').select('report_key',{count:'exact',head:true}).eq('branch','Liloan'),
      db.from('fueltech_backups').select('created_at').order('created_at',{ascending:false}).limit(1),
      db.storage.getBucket(BUCKET),
      cv.storage.getBucket(BACKUP_BUCKET),
    ]);
    for(const r of [reports,backup,bucket,offProjectBucket]) if(r.error) throw Error('A required database or storage check failed.');
    return res.status(200).json({ok:true,mode:config.mode,officialPilotActive:config.mode==='live',checkedAt:new Date().toISOString(),liloanReports:reports.count,sourceWindow:{from:dateOffset(today,-7),to:today},sources:{paidPayments:sources.pay.length,postedPO:sources.po.length,releasedCashVouchers:sources.cvCashEvents.length},privatePhotoStorage:bucket.data.public===false,latestNightlyBackup:backup.data[0]?.created_at||null,physicalStationTest:'REQUIRED',posRedemption:'PENDING'});
  }catch(error){return res.status(503).json({ok:false,error:error.message});}
}
