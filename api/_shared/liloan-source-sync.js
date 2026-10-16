import { createHmac, timingSafeEqual } from 'node:crypto';
import { pilotDatabase, refreshLivePilotSources } from '../../pilot/repository.mjs';

export function validCvSyncRequest(req, body, secret, now=Date.now()) {
  if (!secret || typeof body !== 'object' || !body || Array.isArray(body)) return false;
  if (body.station !== 'liloan' || !['approved','cancelled'].includes(body.status)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.voucherId||'')) return false;
  const timestamp=req.headers['x-fueltech-timestamp'], signature=req.headers['x-fueltech-signature'];
  if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000
      ||typeof signature!=='string'||!/^v1=[0-9a-f]{64}$/.test(signature)) return false;
  const expected=createHmac('sha256',secret).update(`${timestamp}.${body.station}.${body.voucherId}.${body.status}`).digest();
  return timingSafeEqual(expected,Buffer.from(signature.slice(3),'hex'));
}

export async function syncLiveLiloanSources() {
  if(process.env.VERCEL_ENV==='preview') throw Object.assign(new Error('Live source sync is unavailable in previews.'),{status:423});
  // The caller has authenticated as the CV server or scheduler. No amount,
  // shift, count, or report from the request is trusted: re-read source records.
  const applied=await refreshLivePilotSources(pilotDatabase(),{role:'Admin',branch:'Liloan'},{forceSources:true});
  if(!applied)throw Object.assign(new Error('Liloan live source sync is unavailable.'),{status:503});
}
