import { getRequestSession } from '../_shared/session.js';
import { readBody } from '../_shared/supabase.js';
import { execute } from '../../pilot/repository.mjs';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({ok:false});
  const auth=getRequestSession(req);
  if(!auth.ok) return res.status(401).json({ok:false,error:'Please sign in.'});
  const origin=req.headers.origin;
  if(origin) {
    try {if(new URL(origin).host!==req.headers.host) return res.status(403).json({ok:false,error:'Use the station app directly.'});}
    catch{return res.status(403).json({ok:false});}
  }
  try {
    const body=readBody(req);
    if(JSON.stringify(body).length>3*1024*1024) return res.status(413).json({ok:false,error:'Photo is too large. Take a closer photo.'});
    return res.status(200).json(await execute(auth.session,body));
  }catch(error){return res.status(error.status||400).json({ok:false,error:error.message,...(error.staleDraft?{staleDraft:true}:{})});}
}
