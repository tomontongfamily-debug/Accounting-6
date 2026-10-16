import { readBody } from '../_shared/supabase.js';
import { syncLiveLiloanSources, validCvSyncRequest } from '../_shared/liloan-source-sync.js';

export const config={maxDuration:60};
export function createHandler({sync=syncLiveLiloanSources,env=process.env}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
    let body;
    try {body=readBody(req);}catch{return res.status(400).json({ok:false,error:'Invalid request'});}
    if(!validCvSyncRequest(req,body,env.FUELTECH_CV_SYNC_SECRET))return res.status(401).json({ok:false,error:'Unauthorized'});
    try {
      await sync();
      return res.status(200).json({ok:true,station:'liloan',syncedAt:new Date().toISOString()});
    } catch(error) {
      console.error('Liloan CV source sync failed',{status:error.status||503});
      return res.status(error.status||503).json({ok:false,error:'CV saved; Accounting sync will retry automatically.'});
    }
  };
}
export default createHandler();
