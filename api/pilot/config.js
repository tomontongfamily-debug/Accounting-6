import {pilotDatabase} from '../../pilot/repository.mjs';
import {publicConfiguration} from '../../pilot/public-configuration.mjs';

export function configHandler({database=pilotDatabase,load=publicConfiguration,log=console.error}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Vercel-CDN-Cache-Control','no-store');
    if(req.method!=='GET') return res.status(405).json({ok:false});
    try {
      const result=await load(database());
      res.setHeader('Vercel-CDN-Cache-Control','public, s-maxage=5');
      return res.status(200).json(result);
    }catch(error){
      log('Pilot configuration check failed',{stage:error.stage||'database',code:error.code||'CONFIG_UNAVAILABLE'});
      return res.status(503).json({ok:false,error:'The station connection check is temporarily unavailable. Please retry.'});
    }
  };
}
export default configHandler();
