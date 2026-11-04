import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
process.env.SUPABASE_URL='http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-service-key';
process.env.FUELTECH_SESSION_SECRET='test-only-notification-session';
const vapid=webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY=vapid.publicKey;process.env.VAPID_PRIVATE_KEY=vapid.privateKey;
const {default:statusHandler}=await import('../api/notifications/status.js');
const {default:subscribeHandler}=await import('../api/notifications/subscribe.js');
const {createSessionToken}=await import('../api/_shared/session.js');

function response(){return {setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
function request(role,branch,body={}) {return {method:'POST',headers:{'x-fueltech-session':createSessionToken({role,branch})},body};}

test('Manager status returns only Liloan and ignores a client-supplied branch',async()=>{
 const original=globalThis.fetch,queries=[];
 globalThis.fetch=async(input)=>{const url=new URL(input);queries.push(url);return new Response(JSON.stringify([]),{headers:{'Content-Type':'application/json'}});};
 try {
   const res=response();await statusHandler(request('Manager','Liloan',{branch:'Barili'}),res);
   assert.equal(res.code,200);assert.ok(res.body.alerts.length>0);assert.ok(res.body.alerts.every(a=>a.branch==='Liloan'));
   assert.ok(queries.every(q=>q.searchParams.get('branch')==='in.(Liloan)'));
   for(const [role,branch] of [['Manager','Barili'],['Cashier','Liloan'],['Approver','']]){const res=response();await statusHandler(request(role,branch),res);assert.equal(res.code,401);}
   assert.equal(queries.length,1);
 } finally {globalThis.fetch=original;}
});

test('Registration API preserves server-derived manager scope and rejects other station managers',async()=>{
 const original=globalThis.fetch;let store={payload:{subscriptions:[]}},writes=0;
 globalThis.fetch=async(input,options={})=>{
   assert.equal(new URL(input).pathname,'/rest/v1/fueltech_system_health');
   if(options.method==='POST'){store=JSON.parse(options.body);writes++;}
   return new Response(JSON.stringify(store),{headers:{'Content-Type':'application/json'}});
 };
 try {
   const sub={endpoint:'https://fcm.googleapis.com/test-manager',keys:{p256dh:'test',auth:'test'},role:'Admin',branch:'Barili'};
   const res=response();await subscribeHandler(request('Manager','Liloan',{action:'subscribe',subscription:sub,role:'Admin',branch:'Barili'}),res);
   assert.equal(res.code,200);assert.equal(writes,1);assert.equal(store.payload.subscriptions[0].role,'Manager');assert.equal(store.payload.subscriptions[0].branch,'Liloan');
   const config=response();await subscribeHandler(request('Manager','Liloan',{action:'config'}),config);assert.equal(config.code,200);assert.equal(config.body.publicKey,vapid.publicKey);
   for(const [role,branch] of [['Manager','Barili'],['Cashier','Liloan'],['Approver','']]){const res=response();await subscribeHandler(request(role,branch,{action:'subscribe',subscription:sub}),res);assert.equal(res.code,401);}
   assert.equal(writes,1);
 } finally {globalThis.fetch=original;}
});
