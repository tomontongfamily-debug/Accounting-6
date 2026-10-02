import { getRequestSession } from '../_shared/session.js';
import { BUCKET, configuration, pilotDatabase } from '../../pilot/repository.mjs';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET') return res.status(405).end();
  const auth=getRequestSession(req);
  if(!auth.ok) return res.status(401).end();
  const s=auth.session;
  if(!['Admin','Approver','Cashier','Manager'].includes(s.role)||(['Cashier','Manager'].includes(s.role)&&s.branch!=='Liloan')) return res.status(403).end();
  try {
    const id=String(req.query.id||'');
    if(!/^[a-f0-9-]{36}$/i.test(id)) return res.status(404).end();
    const db=pilotDatabase(),cfg=await configuration(db);
    if(cfg.mode==='disabled') return res.status(423).end();
    if(process.env.VERCEL_ENV==='preview'&&cfg.mode!=='shadow') return res.status(423).end();
    const state=await db.from('fueltech_pilot_state').select('data').eq('mode',cfg.mode).single();
    if(state.error) return res.status(503).end();
    const photo=state.data.data.photos['/api/pilot/photo?id='+id];
    if(!photo||photo.branch!=='Liloan'||!photo.file.startsWith(cfg.mode+'/Liloan/')) return res.status(404).end();
    const file=await db.storage.from(BUCKET).download(photo.file);
    if(file.error) return res.status(503).end();
    res.setHeader('Content-Type','image/jpeg');
    return res.status(200).send(Buffer.from(await file.data.arrayBuffer()));
  } catch{return res.status(503).end();}
}
