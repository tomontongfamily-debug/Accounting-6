import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import {missingReportAlerts} from '../src/report-alerts.js';
import {loadMissingReportAlerts} from '../api/_shared/report-alerts.js';
import {sendMissingReportNotifications,pushConfiguration} from '../api/_shared/push.js';
import statusHandler from '../api/notifications/status.js';
import cronHandler from '../api/cron/report-alerts.js';
import {createSessionToken} from '../api/_shared/session.js';
const alertAt=(time,reports=[])=>missingReportAlerts({now:new Date(time),reports,branches:['Liloan']});
const submitted=(shift,date='2026-10-03')=>({branch:'Liloan',date,shiftId:shift,confirmed:true});
test('Two unfinished reports alert after the second shift ends, not during it',()=>{
 assert.deepEqual(alertAt('2026-10-03T21:59:59+08:00'),[]);
 const [a]=alertAt('2026-10-03T22:00:00+08:00');assert.equal(a.count,2);assert.deepEqual(a.shifts,['shift-1','shift-2']);assert.equal(a.message,'Liloan has not submitted 2 reports.');
});
test('Drafts still count; a submitted report drops the count below the threshold',()=>{
 assert.equal(alertAt('2026-10-03T22:01:00+08:00',[{...submitted('shift-1'),confirmed:false}])[0].count,2);
 assert.deepEqual(alertAt('2026-10-03T22:01:00+08:00',[submitted('shift-1')]),[]);
});
test('Shift 3 ends at 4am on the following date and stays with its reporting date',()=>{
 assert.equal(alertAt('2026-10-04T03:59:59+08:00')[0].count,2);
 const [a]=alertAt('2026-10-04T04:00:00+08:00');assert.equal(a.count,3);assert.equal(a.date,'2026-10-03');
});
test('Do not flag old rollout history, future shifts, or opening setup',()=>{
 assert.deepEqual(alertAt('2026-10-02T22:00:00+08:00'),[]);
 assert.deepEqual(alertAt('2026-10-03T22:00:00+08:00',[{...submitted('shift-1'),confirmed:false,baselineReport:true}]),[]);
 assert.deepEqual(alertAt('2026-10-04T04:00:00+08:00',['shift-1','shift-2','shift-3'].map(s=>submitted(s))),[]);
});
test('A late report affects only its own station/date',()=>{
 const reports=['shift-1','shift-2','shift-3'].map(s=>submitted(s));
 const a=missingReportAlerts({now:new Date('2026-10-04T04:00:00+08:00'),reports,branches:['Liloan','Mabolo']});assert.equal(a.length,1);assert.equal(a[0].branch,'Mabolo');
});
test('Report query paginates and fails closed on database errors',async()=>{
 const ranges=[];let page=0;const db={from(){const q={select(){return q;},gte(){return q;},lte(){return q;},order(){return q;},range(a,b){ranges.push([a,b]);return Promise.resolve({data:page++===0?Array.from({length:1000},()=>({branch:'Liloan',report_date:'2026-10-03',shift_id:'shift-1',confirmed:true})):[{branch:'Liloan',report_date:'2026-10-03',shift_id:'shift-2',confirmed:true}]});}};return q;}};
 assert.equal((await loadMissingReportAlerts(db,new Date('2026-10-03T22:00:00+08:00'))).some(a=>a.branch==='Liloan'),false);assert.deepEqual(ranges,[[0,999],[1000,1999]]);
 const broken={from(){const q={select(){return q;},gte(){return q;},lte(){return q;},order(){return q;},range(){return {error:Error('Unavailable')};}};return q;}};
 await assert.rejects(loadMissingReportAlerts(broken),/Unavailable/);
});
function deliveryDb(){
 const rows=new Map([['1900-01-01',{check_date:'1900-01-01',payload:{subscriptions:[{endpoint:'https://fcm.googleapis.com/example',keys:{p256dh:'test',auth:'test'}}]},updated_at:new Date().toISOString()}]]);
 return {rows,from(){let action='select',value,filters=[];const matches=r=>filters.every(([k,v])=>(k==='payload->>lockToken'?r.payload.lockToken:r[k])===v);const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},update(v){action='update';value=v;return q;},insert(v){action='insert';value=v;return q;},upsert(v){action='upsert';value=v;return q;},maybeSingle(){return q.then(r=>({...r,data:r.data?.[0]||null}));},then(resolve,reject){let result={data:[],error:null};if(action==='select')result.data=[...rows.values()].filter(matches).map(r=>structuredClone(r));else if(action==='insert'&&rows.has(value.check_date))result.error={code:'23505'};else if(action==='insert'||action==='upsert'){rows.set(value.check_date,structuredClone(value));result.data=[value];}else for(const [k,r] of rows)if(matches(r)){rows.set(k,structuredClone({...r,...value}));result.data.push(value);}return Promise.resolve(result).then(resolve,reject);}};return q;}};
}
const keys=webpush.generateVAPIDKeys();process.env.VAPID_PUBLIC_KEY=keys.publicKey;process.env.VAPID_PRIVATE_KEY=keys.privateKey;
const example=[{id:'missing-reports:Liloan:2026-10-03',message:'Liloan has not submitted 2 reports.',detail:'2026-10-03 · Shift 1 and Shift 2.'}];
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
test('Notification status rejects non-admin sessions; cron rejects missing authorization',async()=>{
 process.env.FUELTECH_SESSION_SECRET='test-only-not-a-production-secret';
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 for(const role of ['Cashier','Manager','Approver']){await statusHandler({method:'POST',headers:{'x-fueltech-session':createSessionToken({role,branch:'Liloan'})}},res);assert.equal(res.code,401);}
 await cronHandler({method:'GET',headers:{}},res);assert.equal(res.code,401);
});
