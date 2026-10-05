import {useEffect, useState} from 'react';
import {cachedCashierBranch, readStationSession, redirectLiloanLogin, stationRoleFromPath} from './station-routing.js';

export default function StationEntryGate({children}) {
  const role = stationRoleFromPath(window.location.pathname);
  const [checking, setChecking] = useState(Boolean(role));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!role) return undefined;
    let active = true;
    let liloanSession = false;
    readStationSession(role).then(async session => {
      if (!active) return;
      liloanSession = session?.branch === 'Liloan';
      if (session && await redirectLiloanLogin(role, session.branch, {navigate: path => { if (active) window.location.replace(path); }})) return;
      if (active) setChecking(false);
    }).catch(e => {
      if (!active) return;
      // Keep existing offline cashier drafts available at other stations.
      if (liloanSession || (role === 'Cashier' && cachedCashierBranch(window.sessionStorage) === 'Liloan')) setError(e.message);
      else setChecking(false);
    });
    return () => { active = false; };
  }, [role]);
  if (!checking) return children;
  return <main className="section" aria-busy={!error}>
    <h2>{error ? 'Unable to Check Station Login' : 'Checking station login…'}</h2>
    {error ? <><p role="alert">{error}</p><button type="button" className="secondary" onClick={() => window.location.reload()}>Try Again</button></> : <p role="status">Opening the station workflow…</p>}
  </main>;
}
