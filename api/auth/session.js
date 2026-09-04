import { getRequestSession } from "../_shared/session.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.status(405).json({ ok: false });
    return;
  }

  const auth = getRequestSession(req);
  if (!auth.ok || auth.session.role !== "Admin") {
    res.status(401).json({ ok: false });
    return;
  }

  res.status(200).json({ ok: true, role: "Admin", expiresAt: auth.session.exp * 1000 });
}
