import { clearSessionCookie } from "../_shared/session.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }

  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(200).json({ ok: true });
}
