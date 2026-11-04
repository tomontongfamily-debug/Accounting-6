import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import {missingReportAlerts} from '../src/report-alerts.js';
import {loadMissingReportAlerts} from '../api/_shared/report-alerts.js';
import {sendMissingReportNotifications,pushConfiguration,savePushSubscription,removePushSubscription,sendTestNotification,sendCorrectionRequestNotification} from '../api/_shared/push.js';
import {notificationAudience} from '../api/_shared/notification-access.js';
import statusHandler from '../api/notifications/status.js';
import cronHandler from '../api/cron/report-alerts.js';
import {createSessionToken} from '../api/_shared/session.js';
const alertAt=(time,reports=[])=>missingReportAlerts({now:new Date(time),reports,branches:['Liloan']});
const submitted=(shift,date='2026-10-03')=>({branch:'Liloan',date,shiftId:shift,confirmed:true});
test('Liloan Shift 1 becomes overdue exactly one hour after it ends',()=>{
 assert.deepEqual(alertAt('2026-10-03T13:59:59.999+08:00'),[]);
 const [a]=alertAt('2026-10-03T14:00:00+08:00');assert.equal(a.count,1);assert.deepEqual(a.shifts,['shift-1']);assert.equal(a.message,'Liloan Shift 1 report is overdue.');assert.equal(a.deadlineAt,'2026-10-03T06:00:00.000Z');
});
test('Shift 2 gets its own alert at 11pm, not when the shift ends',()=>{
 assert.equal(alertAt('2026-10-03T22:59:59.999+08:00').length,1);
 const alerts=alertAt('2026-10-03T23:00:00+08:00');assert.equal(alerts.length,2);assert.equal(new Set(alerts.map(a=>a.id)).size,2);assert.equal(alerts.find(a=>a.shifts[0]==='shift-2').deadlineAt,'2026-10-03T15:00:00.000Z');
});
test('Other stations retain the existing two ended shift rule',()=>{
 const alerts=missingReportAlerts({now:new Date('2026-10-03T22:00:00+08:00'),branches:['Mabolo']});assert.equal(alerts.length,1);assert.equal(alerts[0].count,2);assert.deepEqual(alerts[0].shifts,['shift-1','shift-2']);
});
test('Drafts remain overdue; a late submission clears only its own shift',()=>{
 assert.equal(alertAt('2026-10-03T14:00:00+08:00',[{...submitted('shift-1'),confirmed:false}])[0].count,1);
 assert.deepEqual(alertAt('2026-10-03T14:00:00+08:00',[submitted('shift-1')]),[]);
 const alerts=alertAt('2026-10-03T23:00:00+08:00',[submitted('shift-1')]);assert.equal(alerts.length,1);assert.deepEqual(alerts[0].shifts,['shift-2']);
});
test('Shift 3 is due at 5am next day and retains its reporting date across month end',()=>{
 const input={branches:['Liloan'],startDate:'2026-10-31'};
 assert.equal(missingReportAlerts({...input,now:new Date('2026-11-01T04:59:59.999+08:00')}).length,2);
 const a=missingReportAlerts({...input,now:new Date('2026-11-01T05:00:00+08:00')}).find(a=>a.shifts[0]==='shift-3');assert.equal(a.date,'2026-10-31');assert.equal(a.deadlineAt,'2026-10-31T21:00:00.000Z');assert.equal(a.reportKey,'Liloan__2026-10-31__shift-3');
});
test('Do not flag old rollout history, future shifts, or opening setup',()=>{
 assert.deepEqual(alertAt('2026-10-02T22:00:00+08:00'),[]);
 assert.deepEqual(alertAt('2026-10-03T14:00:00+08:00',[{...submitted('shift-1'),confirmed:false,baselineReport:true}]),[]);
 assert.deepEqual(alertAt('2026-10-03T14:00:00+08:00',[{...submitted('shift-1'),confirmed:false,openingSetupComplete:true}]),[]);
 assert.deepEqual(alertAt('2026-10-04T04:00:00+08:00',['shift-1','shift-2','shift-3'].map(s=>submitted(s))),[]);
});
test('A late report affects only its own station/date',()=>{
 const reports=['shift-1','shift-2','shift-3'].map(s=>submitted(s));
 const a=missingReportAlerts({now:new Date('2026-10-04T04:00:00+08:00'),reports,branches:['Liloan','Mabolo']});assert.equal(a.length,1);assert.equal(a[0].branch,'Mabolo');
});
test('Report query paginates and fails closed on database errors',async()=>{
 const ranges=[];let page=0;const db={from(){const q={select(){return q;},in(){return q;},gte(){return q;},lte(){return q;},order(){return q;},range(a,b){ranges.push([a,b]);return Promise.resolve({data:page++===0?Array.from({length:1000},()=>({branch:'Liloan',report_date:'2026-10-03',shift_id:'shift-1',confirmed:true})):[{branch:'Liloan',report_date:'2026-10-03',shift_id:'shift-2',confirmed:true}]});}};return q;}};
 assert.equal((await loadMissingReportAlerts(db,new Date('2026-10-03T22:00:00+08:00'))).some(a=>a.branch==='Liloan'),false);assert.deepEqual(ranges,[[0,999],[1000,1999]]);
 const broken={from(){const q={select(){return q;},in(){return q;},gte(){return q;},lte(){return q;},order(){return q;},range(){return {error:Error('Unavailable')};}};return q;}};
 await assert.rejects(loadMissingReportAlerts(broken),/Unavailable/);
});
function deliveryDb(){
 const rows=new Map([['1900-01-01',{check_date:'1900-01-01',payload:{subscriptions:[{endpoint:'https://fcm.googleapis.com/example',keys:{p256dh:'test',auth:'test'}}]},updated_at:new Date().toISOString()}]]);
 return {rows,from(){let action='select',value,filters=[];const matches=r=>filters.every(([k,v])=>(k==='payload->>lockToken'?r.payload.lockToken:r[k])===v);const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},update(v){action='update';value=v;return q;},insert(v){action='insert';value=v;return q;},upsert(v){action='upsert';value=v;return q;},maybeSingle(){return q.then(r=>({...r,data:r.data?.[0]||null}));},then(resolve,reject){let result={data:[],error:null};if(action==='select')result.data=[...rows.values()].filter(matches).map(r=>structuredClone(r));else if(action==='insert'&&rows.has(value.check_date))result.error={code:'23505'};else if(action==='insert'||action==='upsert'){rows.set(value.check_date,structuredClone(value));result.data=[value];}else for(const [k,r] of rows)if(matches(r)){rows.set(k,structuredClone({...r,...value}));result.data.push(value);}return Promise.resolve(result).then(resolve,reject);}};return q;}};
}
const keys=webpush.generateVAPIDKeys();process.env.VAPID_PUBLIC_KEY=keys.publicKey;process.env.VAPID_PRIVATE_KEY=keys.privateKey;
const example=[{id:'missing-report:Liloan__2026-10-03__shift-1',branch:'Liloan',message:'Liloan Shift 1 report is overdue.',detail:'2026-10-03 · Shift 1 and Shift 2.'}];
test('Push delivered once per phone/station/date even across retries',async()=>{
 const db=deliveryDb();let sends=0;const send=async(s,payload)=>{sends++;assert.match(JSON.parse(payload).body,/Shift 1 and Shift 2/);};
 assert.equal((await sendMissingReportNotifications(db,example,{send})).sent,1);
 assert.equal((await sendMissingReportNotifications(db,example,{send})).sent,0);assert.equal(sends,1);
});
test('Failed delivery remains retryable; an expired subscription is removed',async()=>{
 const db=deliveryDb();assert.equal((await sendMissingReportNotifications(db,example,{send:async()=>{throw {statusCode:503};}})).failed,1);
 assert.equal((await sendMissingReportNotifications(db,example,{send:async()=>{}})).sent,1);
 const expired=deliveryDb();await sendMissingReportNotifications(expired,example,{send:async()=>{throw {statusCode:410};}});assert.equal(expired.rows.get('1900-01-01').payload.subscriptions.length,0);
});
test('Overlapping cron calls cannot claim the same notification batch',async()=>{
 const db=deliveryDb();let release,started;const begun=new Promise(r=>started=r),pending=new Promise(r=>release=r);
 const first=sendMissingReportNotifications(db,example,{send:async()=>{started();await pending;}});await begun;
 assert.equal((await sendMissingReportNotifications(db,example,{send:async()=>assert.fail('Duplicate push')})).busy,true);release();await first;
});
test('Push config requires both keys, not a public key alone',()=>{const key=process.env.VAPID_PRIVATE_KEY;delete process.env.VAPID_PRIVATE_KEY;assert.equal(pushConfiguration().ready,false);process.env.VAPID_PRIVATE_KEY=key;});
test('Notification access allows only Admin and the Liloan manager; cron rejects missing authorization',async()=>{
 process.env.FUELTECH_SESSION_SECRET='test-only-not-a-production-secret';
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 for(const role of ['Cashier','Approver']){await statusHandler({method:'POST',headers:{'x-fueltech-session':createSessionToken({role,branch:'Liloan'})}},res);assert.equal(res.code,401);}
 assert.deepEqual(notificationAudience({role:'Manager',branch:'Liloan'}),{role:'Manager',branch:'Liloan'});
 for(const branch of ['Barili','',undefined]){assert.equal(notificationAudience({role:'Manager',branch}),null);await statusHandler({method:'POST',headers:{'x-fueltech-session':createSessionToken({role:'Manager',branch})}},res);assert.equal(res.code,401);}
 await cronHandler({method:'GET',headers:{}},res);assert.equal(res.code,401);
});

test('Each overdue shift reaches Admin and only its station manager once',async()=>{
 const db=deliveryDb(),legacy=db.rows.get('1900-01-01').payload.subscriptions[0];
 db.rows.get('1900-01-01').payload.subscriptions.push({...legacy,endpoint:'https://fcm.googleapis.com/liloan',role:'Manager',branch:'Liloan'},{...legacy,endpoint:'https://fcm.googleapis.com/barili',role:'Manager',branch:'Barili'});
 const calls=[],send=async(s,p)=>calls.push({endpoint:s.endpoint,payload:JSON.parse(p)});
 const other={...example[0],id:'other-station',branch:'Barili'};
 assert.equal((await sendMissingReportNotifications(db,[...example,other],{send})).sent,3);
 assert.deepEqual(calls.filter(c=>c.endpoint.endsWith('/liloan')).map(c=>c.payload.url),['/manager']);
 assert.equal(calls.filter(c=>c.endpoint.endsWith('/barili')).length,0);
 assert.equal((await sendMissingReportNotifications(db,[...example,other],{send})).sent,0);
 const next={...example[0],id:'missing-report:Liloan__2026-10-03__shift-2'};
 assert.equal((await sendMissingReportNotifications(db,[next],{send})).sent,2);
});

test('Manager registration derives its station from the session and cannot remove an Admin phone',async()=>{
 const db=deliveryDb(),legacy=db.rows.get('1900-01-01').payload.subscriptions[0],manager={role:'Manager',branch:'Liloan'};
 await savePushSubscription(db,{...legacy,endpoint:'https://fcm.googleapis.com/manager',role:'Admin',branch:'Barili'},manager);
 assert.deepEqual(db.rows.get('1900-01-01').payload.subscriptions.map(s=>[s.role||'Admin',s.branch||'']),[['Admin',''],['Manager','Liloan']]);
 await removePushSubscription(db,legacy.endpoint,manager);assert.equal(db.rows.get('1900-01-01').payload.subscriptions.length,2);
 await assert.rejects(sendTestNotification(db,legacy.endpoint,manager),/Enable alerts/);
 await assert.rejects(savePushSubscription(db,legacy,{role:'Manager',branch:'Barili'}),/login required/);
 await removePushSubscription(db,'https://fcm.googleapis.com/manager',manager);assert.equal(db.rows.get('1900-01-01').payload.subscriptions.length,1);
});

test('Correction requests remain Admin-only after manager subscriptions are introduced',async()=>{
 const db=deliveryDb(),legacy=db.rows.get('1900-01-01').payload.subscriptions[0];db.rows.get('1900-01-01').payload.subscriptions.push({...legacy,endpoint:'https://fcm.googleapis.com/manager',role:'Manager',branch:'Liloan'});
 const original=webpush.sendNotification,calls=[];webpush.sendNotification=async(s)=>calls.push(s.endpoint);
 try {assert.equal((await sendCorrectionRequestNotification(db,{branch:'Liloan',date:'2026-10-03',shiftId:'shift-1'})).sent,1);assert.deepEqual(calls,[legacy.endpoint]);}finally{webpush.sendNotification=original;}
});
