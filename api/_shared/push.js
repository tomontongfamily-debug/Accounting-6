import webpush from "web-push";
import { createHash, randomUUID } from 'node:crypto';

const PUSH_STORE_DATE = "1900-01-01";
const MAX_SUBSCRIPTIONS = 20;

function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@fueltechphil.com";
  return { publicKey, privateKey, subject, ready: Boolean(publicKey && privateKey) };
}

export function pushConfiguration(){const {ready,publicKey}=pushConfig();return {ready,publicKey:ready?publicKey:''};}

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
  return pushConfiguration().publicKey;
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

export async function sendTestNotification(supabase,endpoint){
  const config=pushConfig();if(!config.ready)throw Error('Notification service is not configured yet.');
  const subscription=(await loadSubscriptionStore(supabase)).find(s=>s.endpoint===endpoint);
  if(!subscription)throw Error('Enable alerts on this phone first.');
  webpush.setVapidDetails(config.subject,config.publicKey,config.privateKey);
  try{await webpush.sendNotification(subscription,JSON.stringify({title:'FuelTech test alert',body:'This phone can receive missing-report and correction alerts.',tag:'fueltech-test',url:'/admin?view=alerts'}),{TTL:300,timeout:10000});}
  catch(e){if([404,410].includes(e.statusCode))await removePushSubscription(supabase,endpoint);throw Error('The phone could not receive the test alert. Enable alerts again and check phone notification settings.');}
  return {sent:1};
}

const DELIVERY_STORE_DATE='1900-01-02';
const endpointKey=s=>createHash('sha256').update(s.endpoint).digest('hex');
// A compare-and-swap lease prevents concurrent cron retries from sending duplicates.
async function claimDeliveryStore(supabase,now){
  const {data,error}=await supabase.from('fueltech_system_health').select('payload,updated_at').eq('check_date',DELIVERY_STORE_DATE).maybeSingle();
  if(error)throw error;
  if(Date.parse(data?.payload?.lockedUntil||'')>now.getTime())return null;
  const payload={kind:'admin-report-alert-deliveries',delivered:data?.payload?.delivered||{},lockToken:randomUUID(),lockedUntil:new Date(now.getTime()+120000).toISOString()};
  const row={check_date:DELIVERY_STORE_DATE,payload,missing_reports:0,missing_deposits:0,pending_deposits:0,cash_variance:0,updated_at:now.toISOString()};
  let result;
  if(data)result=await supabase.from('fueltech_system_health').update(row).eq('check_date',DELIVERY_STORE_DATE).eq('updated_at',data.updated_at).select('check_date');
  else result=await supabase.from('fueltech_system_health').insert(row).select('check_date');
  if(result.error?.code==='23505'||(!result.error&&!result.data?.length))return null;
  if(result.error)throw result.error;
  return payload;
}
async function saveDeliveries(supabase,payload,release=false){
  const {data,error}=await supabase.from('fueltech_system_health').update({payload:{...payload,lockedUntil:release?null:payload.lockedUntil},updated_at:new Date().toISOString()})
    .eq('check_date',DELIVERY_STORE_DATE).eq('payload->>lockToken',payload.lockToken).select('check_date');
  if(error)throw error;if(!data?.length)throw Error('Notification delivery lease expired.');
}
export async function sendMissingReportNotifications(supabase,alerts,{now=new Date(),send=webpush.sendNotification.bind(webpush)}={}){
  const config=pushConfig();if(!config.ready)return {sent:0,disabled:true};
  if(!alerts.length)return {sent:0};
  const subscriptions=await loadSubscriptionStore(supabase);if(!subscriptions.length)return {sent:0,subscribers:0};
  const ledger=await claimDeliveryStore(supabase,now);if(!ledger)return {sent:0,busy:true};
  webpush.setVapidDetails(config.subject,config.publicKey,config.privateKey);
  let sent=0,failed=0;const expired=new Set();
  try{
    for(const alert of alerts){
      if(Date.now()>Date.parse(ledger.lockedUntil)-15000)break;
      const recipients=subscriptions.filter(s=>!ledger.delivered[alert.id]?.[endpointKey(s)]&&!expired.has(s.endpoint));
      const results=await Promise.allSettled(recipients.map(s=>send(s,JSON.stringify({title:alert.message,body:alert.detail,tag:alert.id,url:'/admin?view=alerts'}),{TTL:3600,timeout:10000})));
      results.forEach((r,i)=>{if(r.status==='fulfilled'){ledger.delivered[alert.id]??={};ledger.delivered[alert.id][endpointKey(recipients[i])]=now.toISOString();sent++;}else{failed++;if([404,410].includes(r.reason?.statusCode))expired.add(recipients[i].endpoint);}});
      await saveDeliveries(supabase,ledger);
    }
    for(const endpoint of expired)await removePushSubscription(supabase,endpoint);
    return {sent,failed,subscribers:subscriptions.length};
  }finally{await saveDeliveries(supabase,ledger,true);}
}
