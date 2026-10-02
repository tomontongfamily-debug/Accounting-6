import { configuration,pilotDatabase } from '../../pilot/repository.mjs';
import { launchStatus } from '../../pilot/launch.mjs';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false});
  try {const db=pilotDatabase(),config=await configuration(db);return res.status(200).json({ok:true,...config,launch:await launchStatus(db,config)});}
  catch{return res.status(503).json({ok:false,error:'Liloan pilot preparation is not available yet.'});}
}
