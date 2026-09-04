import webpush from "web-push";

const PUSH_STORE_DATE = "1900-01-01";
const MAX_SUBSCRIPTIONS = 20;

function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@fueltechphil.com";
  return { publicKey, privateKey, subject, ready: Boolean(publicKey && privateKey) };
}

function validSubscription(subscription) {
  return Boolean(
    subscription?.endpoint
    && subscription?.keys?.p256dh
    && subscription?.keys?.auth
  );
}

async function loadSubscriptionStore(supabase) {
  const { data, error } = await supabase
    .from("fueltech_system_health")
    .select("payload")
    .eq("check_date", PUSH_STORE_DATE)
    .maybeSingle();
  if (error) throw error;
  const subscriptions = Array.isArray(data?.payload?.subscriptions)
    ? data.payload.subscriptions.filter(validSubscription)
    : [];
  return subscriptions;
}

async function saveSubscriptionStore(supabase, subscriptions) {
  const unique = [...new Map(subscriptions.map((item) => [item.endpoint, item])).values()]
    .slice(-MAX_SUBSCRIPTIONS);
  const { error } = await supabase.from("fueltech_system_health").upsert({
    check_date: PUSH_STORE_DATE,
    payload: { kind: "admin-push-subscriptions", subscriptions: unique },
    missing_reports: 0,
    missing_deposits: 0,
    pending_deposits: 0,
    cash_variance: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: "check_date" });
  if (error) throw error;
}

export function vapidPublicKey() {
  return pushConfig().publicKey;
}

export async function savePushSubscription(supabase, subscription) {
  if (!validSubscription(subscription)) throw new Error("Invalid notification subscription.");
  const subscriptions = await loadSubscriptionStore(supabase);
  await saveSubscriptionStore(supabase, [
    ...subscriptions.filter((item) => item.endpoint !== subscription.endpoint),
    { ...subscription, savedAt: new Date().toISOString() },
  ]);
}

export async function removePushSubscription(supabase, endpoint) {
  if (!endpoint) return;
  const subscriptions = await loadSubscriptionStore(supabase);
  await saveSubscriptionStore(supabase, subscriptions.filter((item) => item.endpoint !== endpoint));
}

export async function sendCorrectionRequestNotification(supabase, report) {
  const config = pushConfig();
  if (!config.ready) return { sent: 0, disabled: true };

  const subscriptions = await loadSubscriptionStore(supabase);
  if (subscriptions.length === 0) return { sent: 0 };

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const request = report.correctionRequest || {};
  const payload = JSON.stringify({
    title: "New correction request",
    body: `${report.branch} - ${request.reportDate || report.date} - Shift ${String(request.shiftId || report.shiftId).slice(-1)}`,
    tag: `correction-${request.id || `${report.branch}-${report.date}-${report.shiftId}`}`,
    url: "/admin?view=corrections",
  });
  const results = await Promise.allSettled(subscriptions.map((subscription) =>
    webpush.sendNotification(subscription, payload)
  ));
  const expiredEndpoints = results.flatMap((result, index) => {
    if (result.status === "rejected" && [404, 410].includes(result.reason?.statusCode)) {
      return [subscriptions[index].endpoint];
    }
    return [];
  });
  if (expiredEndpoints.length) {
    await saveSubscriptionStore(supabase, subscriptions.filter((item) => !expiredEndpoints.includes(item.endpoint)));
  }
  return { sent: results.filter((result) => result.status === "fulfilled").length };
}
