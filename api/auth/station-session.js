import {getRequestSession} from '../_shared/session.js';

const branches = ['Mabolo', 'Arpili', 'Liloan', 'Pondol', 'Barili', 'Moalboal'];

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ok: false});
  const auth = getRequestSession(req);
  if (!auth.ok) return res.status(401).json({ok: false});
  if (!['Cashier', 'Manager'].includes(auth.session.role) || !branches.includes(auth.session.branch)) return res.status(403).json({ok: false});
  return res.status(200).json({ok: true, role: auth.session.role, branch: auth.session.branch, expiresAt: auth.session.exp * 1000});
}
