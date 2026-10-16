import { syncLiveLiloanSources } from '../_shared/liloan-source-sync.js';

export const config={maxDuration:60};
export function createHandler({sync=syncLiveLiloanSources,env=process.env}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
    if(!env.CRON_SECRET||req.headers.authorization!==`Bearer ${env.CRON_SECRET}`)return res.status(401).json({ok:false,error:'Unauthorized'});
    try {
      await sync();
      return res.status(200).json({ok:true,station:'liloan',syncedAt:new Date().toISOString()});
    } catch(error) {
      console.error('Liloan scheduled source sync failed',{status:error.status||503});
      return res.status(error.status||503).json({ok:false,error:'Liloan source sync needs retry.'});
    }
  };
}
export default createHandler();
