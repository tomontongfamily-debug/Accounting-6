import { getRequestSession } from "../_shared/session.js";
import { readBody, supabaseAdmin } from "../_shared/supabase.js";
import { removePushSubscription, savePushSubscription, vapidPublicKey } from "../_shared/push.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const auth = getRequestSession(req);
    if (!auth.ok || auth.session.role !== "Admin") {
      return res.status(401).json({ ok: false, error: "Admin login required." });
    }

    const { action = "config", subscription, endpoint } = readBody(req);
    const publicKey = vapidPublicKey();
    if (!publicKey) return res.status(503).json({ ok: false, error: "Notification service is not configured yet." });
    if (action === "config") return res.status(200).json({ ok: true, publicKey });

    const supabase = supabaseAdmin();
    if (action === "subscribe") {
      await savePushSubscription(supabase, subscription);
      return res.status(200).json({ ok: true, enabled: true });
    }
    if (action === "unsubscribe") {
      await removePushSubscription(supabase, endpoint || subscription?.endpoint);
      return res.status(200).json({ ok: true, enabled: false });
    }
    return res.status(400).json({ ok: false, error: "Invalid notification action." });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Unable to update notifications." });
  }
}
