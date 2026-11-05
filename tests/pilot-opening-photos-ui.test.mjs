import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {fixture,openingPhoto} from './pilot-fixture.mjs';
import {prepareStationRollout} from '../pilot/station-rollout.mjs';
import {withStationRollout} from '../src/station-rollout.js';
import {runAction} from '../pilot/service.mjs';
import {pumpCameraBootstrap,capturePumpCamera} from './pilot-camera-fixture.mjs';

test('Opening photos save automatic and reviewed manual readings from a phone and let desktop confirm the setup',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-04T22:05:00+08:00')});
 const server=await createServer({server:{host:'127.0.0.1',port:4367,strictPort:true}});await server.listen();
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let {state}=fixture();state.mode='live';state.startDate='2026-10-03';
 const config=withStationRollout({ok:true,mode:'live',start_date:state.startDate,launch:{ready:true}});
 prepareStationRollout(state,config);
 const key='Mabolo__2026-11-04__shift-3',cashier={role:'Cashier',branch:'Mabolo'},originalLiloan=structuredClone(state.reports['Liloan__2026-09-23__shift-1']);
 const uploads=new Map(),errors=[];
 let queue=Promise.resolve();
 async function context(viewport){
  const ctx=await browser.newContext({viewport,timezoneId:'Asia/Manila'});
  await ctx.addInitScript(pumpCameraBootstrap);
  await ctx.route('**/src/totalizer-ocr.js*',route=>route.fulfill({contentType:'text/javascript',body:`export async function prepareTotalizer(){};let calls=0;export async function detectTotalizerResult(){const reading=++calls===1?123456.78:null;return {reading,attempt:{status:reading===null?'no-reading':'detected',version:'opening-browser-fixture'}};}`}));
  await ctx.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let result,status=200;
   if(path==='/api/pilot/config')result=config;
   else if(path.startsWith('/api/auth/'))result={ok:true,...cashier,token:'cookie',expiresAt:Date.now()+3600000};
   else if(path==='/api/pilot/photo')return route.fulfill({contentType:'image/jpeg',body:uploads.get(new URL(route.request().url()).searchParams.get('id'))});
   else if(path==='/api/pilot/action'){
    const body=route.request().postDataJSON();
    try{
     const out=await(queue=queue.catch(()=>{}).then(async()=>{const next=await runAction(state,cashier,body.route,body.input,{mutationId:body.mutationId,uploadPhoto:async(path,image)=>uploads.set(body.mutationId,image)});state=next.state;return next;}));
     result=out.result;
    }catch(e){status=e.status||400;result={ok:false,error:e.message};}
   }else result={ok:true,enabled:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:Date.parse('2026-11-04T14:05:00Z')});
  await page.clock.setFixedTime(Date.parse('2026-11-04T14:05:00Z'));
  await page.goto('http://127.0.0.1:4367/cashier');
  assert.equal(await page.evaluate(()=>Date.now()),Date.parse('2026-11-04T14:05:00Z'));
  await page.getByRole('heading',{name:'Choose a shift',exact:true}).waitFor().catch(async error=>{console.error('Opening setup fixture:',JSON.stringify({errors,screen:await page.locator('body').innerText()}));throw error;});
  await page.locator('.cashier-opening-card').click();
  await page.getByRole('heading',{name:'Opening pump readings',exact:true}).waitFor();
  return {ctx,page};
 }
 try{
  const {ctx:desktopContext,page:desktop}=await context({width:1280,height:1000});
  await desktop.getByLabel('Setup Cashier Name',{exact:true}).fill('Photo setup cashier');
  await desktop.locator('input[inputmode=decimal]').first().fill('777');
  await expect.poll(()=>state.reports[key].tankRows[0].opening).toBe('777');
  const {ctx:phoneContext,page:phone}=await context({width:390,height:844});
  assert.equal(await phone.locator('input[type=file]').count(),0);
  const rows=state.reports[key].pumpRows;
  for(const [index,row] of rows.slice(0,2).entries()){
   await phone.getByRole('button',{name:new RegExp('^'+row.pump+' ·')}).click();
   const card=phone.locator(`[data-pump-row-id="${row.id}"]`);
   await capturePumpCamera(phone,card);
   if(index===0){
    await expect(card.getByRole('textbox',{name:`${row.pump} ${row.nozzle} opening reading`,exact:true})).toHaveValue('123456.78');
   }else{
    await card.getByRole('button',{name:'Enter number manually',exact:true}).waitFor();
    await card.getByRole('button',{name:'Enter number manually',exact:true}).click();
    await card.getByRole('textbox',{name:`${row.pump} ${row.nozzle} opening reading`,exact:true}).fill('0');
   }
   await card.getByRole('button',{name:'Yes, confirm reading',exact:true}).click();
   await card.getByText('✓ Complete',{exact:true}).waitFor();
   assert.equal(state.reports[key].pumpRows[index].opening,index===0?123456.78:0);
  }
  assert.equal(await phone.getByRole('button',{name:'Confirm Opening Setup',exact:true}).isDisabled(),true);
  await desktop.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>desktop.locator(`[data-pump-row-id="${rows[0].id}"]`).innerText()).toMatch(/123,456.78/);
  assert.equal(await desktop.locator('input[inputmode=decimal]').first().inputValue(),'777');
  fs.mkdirSync('test-output',{recursive:true});
  await phone.screenshot({path:'test-output/opening-photo-phone.png',fullPage:true});
  for(const row of rows.slice(2))state=await openingPhoto(state,key,row.id,10000);
  await desktop.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(desktop.getByRole('button',{name:'Confirm Opening Setup',exact:true})).toBeEnabled();
  for(const input of (await desktop.locator('input[inputmode=decimal]').all()).slice(1))await input.fill('0');
  await desktop.screenshot({path:'test-output/opening-photo-desktop.png',fullPage:true});
  await desktop.getByRole('button',{name:'Confirm Opening Setup',exact:true}).click();
  await expect.poll(()=>state.reports[key].confirmed).toBe(true);
  await desktop.getByRole('heading',{name:'Opening Setup Complete',exact:true}).waitFor();
  await desktop.getByRole('heading',{name:'Opening pump readings',exact:true}).waitFor();
  assert.equal(await desktop.getByRole('button',{name:'Open camera',exact:true}).count(),0);
  assert.equal(state.reports[key].pumpRows[0].opening,123456.78);
  assert.equal(state.reports[key].pumpRows[1].opening,0);
  assert.equal(state.reports[key].tankRows[0].opening,'777');
  assert.deepEqual(state.reports['Liloan__2026-09-23__shift-1'],originalLiloan);
  assert.deepEqual(errors,[]);
  await desktopContext.close();await phoneContext.close();
 }finally{await browser.close();await server.close();}
});
