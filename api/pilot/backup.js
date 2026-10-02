import { getRequestSession } from '../_shared/session.js';
import { configuration,pilotDatabase } from '../../pilot/repository.mjs';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false});
  const auth=getRequestSession(req);
  if(!auth.ok||auth.session.role!=='Admin') return res.status(403).json({ok:false});
  try {
    const db=pilotDatabase(),config=await configuration(db);
    if(process.env.VERCEL_ENV==='preview'&&config.mode!=='shadow') return res.status(423).json({ok:false});
    const [baseline,state]=await Promise.all([
      db.from('fueltech_pilot_baseline').select('created_at,payload').eq('branch','Liloan').order('created_at',{ascending:false}).limit(1),
      db.from('fueltech_pilot_state').select('revision,data,updated_at').eq('mode',config.mode).maybeSingle(),
    ]);
    if(baseline.error||state.error) throw Error('Unable to export a verified backup.');
    res.setHeader('Content-Disposition','attachment; filename="liloan-pilot-backup.json"');
    return res.status(200).json({ok:true,schemaVersion:1,exportedAt:new Date().toISOString(),config,baseline:baseline.data[0],state:state.data});
  }catch(error){return res.status(503).json({ok:false,error:error.message});}
}
