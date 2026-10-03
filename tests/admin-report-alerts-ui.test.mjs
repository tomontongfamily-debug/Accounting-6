import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {chromium} from '@playwright/test';import {preview} from 'vite';
import {fixture} from './pilot-fixture.mjs';import {runAction} from '../pilot/service.mjs';
test('Both mobile admin routes show missing shifts and verify notification registration',async()=>{
 const server=await preview({preview:{host:'127.0.0.1',port:4337,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const path of ['/admin','/pilot/admin']){
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Manila'});let {state}=fixture(),missing=true,failRegistration=true;const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   let subscription=null;class TestNotification{};TestNotification.permission='default';TestNotification.requestPermission=async()=>{TestNotification.permission='granted';return 'granted';};window.Notification=TestNotification;window.PushManager=class {};
   const registration={pushManager:{getSubscription:async()=>subscription,subscribe:async({applicationServerKey})=>{subscription={endpoint:'https://fcm.googleapis.com/test-phone',options:{applicationServerKey:applicationServerKey.buffer},toJSON:()=>({endpoint:'https://fcm.googleapis.com/test-phone',keys:{p256dh:'test',auth:'test'}}),unsubscribe:async()=>{subscription=null;}};return subscription;}}};
   Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration)},configurable:true});
  });
  await page.route('**/api/**',async route=>{
   const p=new URL(route.request().url()).pathname;let result,status=200;const body=route.request().method()==='POST'?route.request().postDataJSON():{};
   if(p==='/api/pilot/config')result={ok:true,mode:'live',start_date:'2026-09-23',launch:{ready:true}};
   else if(p.startsWith('/api/auth/'))result={ok:true,role:'Admin',token:'cookie',branch:'',expiresAt:Date.now()+3600000};
   else if(p==='/api/notifications/status')result={ok:true,alerts:missing?[{id:'sample',message:'Liloan has not submitted 2 reports.',detail:'2026-10-03 · Shift 1 and Shift 2. These shifts have ended; drafts are not submitted reports.'}]:[],checkedAt:new Date().toISOString(),push:{ready:true,publicKey:'AQIDBA'}};
   else if(p==='/api/notifications/subscribe'){
    calls.push(body.action);if(body.action==='config')result={ok:true,publicKey:'AQIDBA'};
    else if(body.action==='subscribe'&&failRegistration){status=503;result={ok:false,error:'Notification registration unavailable'};}
    else result={ok:true,enabled:true,sent:body.action==='test'?1:undefined};
   }else{const action=p==='/api/pilot/action'?body.route:p;assert.equal(action.startsWith('/api/notifications/'),false,'Notifications must not enter pilot accounting mutations');try{const outcome=await runAction(state,{role:'Admin',branch:''},action,p==='/api/pilot/action'?body.input:body);state=outcome.state;result=outcome.result;}catch(e){status=e.status||400;result={ok:false,error:e.message};}}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://127.0.0.1:4337'+path);await page.getByText('Liloan has not submitted 2 reports.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Enable Alerts',exact:true}).click();await page.getByText('Notification registration unavailable',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Send test alert',exact:true}).count(),0);
  failRegistration=false;await page.getByRole('button',{name:'Enable Alerts',exact:true}).click();await page.getByRole('button',{name:'Send test alert',exact:true}).waitFor();
  await page.getByRole('button',{name:'Send test alert',exact:true}).click();await page.getByText('Test accepted by the push service. Check your phone’s notifications.',{exact:true}).waitFor();assert.equal(calls.filter(c=>c==='test').length,1);
  await page.getByRole('button',{name:'Alerts',exact:true}).click();assert.match(page.url(),/view=alerts/);
  fs.mkdirSync('../../work/admin-alerts-review',{recursive:true});await page.locator('.admin-report-alerts').screenshot({path:`../../work/admin-alerts-review/${path.includes('pilot')?'pilot':'all-stations'}.png`});
  missing=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('No station has two completed shift reports missing.',{exact:true}).waitFor();assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();server.httpServer.closeAllConnections();server.httpServer.close();}
});
