import test from 'node:test';
import assert from 'node:assert/strict';
import { accountingTiming,sourceTiming,normalizeSources,loadSources,verifiedPaymentTime,LILOAN_STATION_ID } from '../pilot/integrations.mjs';
import { reconcileSources } from '../pilot/state.mjs';
import { fixture } from './pilot-fixture.mjs';

test('Manila boundaries and Pay/PO overnight ending-date conversion',()=>{
  for(const [time,date,shiftId] of [['2026-09-23T03:59:59+08:00','2026-09-22','shift-3'],['2026-09-23T04:00:00+08:00','2026-09-23','shift-1'],['2026-09-23T13:00:00+08:00','2026-09-23','shift-2'],['2026-09-23T22:00:00+08:00','2026-09-23','shift-3']]) assert.deepEqual(accountingTiming(time),{date,shiftId});
  assert.deepEqual(sourceTiming('2026-10-01','Shift 3'),{date:'2026-09-30',shiftId:'shift-3'});
  assert.throws(()=>sourceTiming('2026-02-30','shift-1'));
});
test('CV approved/liquidated/cleared have identical single release; declined and online excluded',()=>{
  const base={id:'cv1',ref:'CV1',station:'liloan',payment_method:'cash',amount:1000,decided_at:'2026-09-23T05:00:00+08:00',category:{name:'OPEX'},purpose:'Supplies'};
  const normalize=status=>normalizeSources({cv:[{...base,status,change_amount:100}]},'2026-09-23');
  for(const status of ['approved','liquidated','cleared','released']) {
    assert.equal(normalize(status).cvCashEvents[0].amount,1000);
    assert.deepEqual(normalize(status),normalize('approved'));
  }
  assert.equal(normalize('declined').cvCashEvents.length,0);
  assert.equal(normalize('pending').cvCashEvents.length,0);
  assert.equal(normalizeSources({cv:[{...base,status:'approved',payment_method:'online'}]},'2026-09-23').cvCashEvents.length,0);
  assert.throws(()=>normalizeSources({cv:[{...base,status:'approved',decided_at:null}]},'2026-09-23'),/timezone|valid time/);
});
test('Paid base amount excludes fee, PO stable IDs deduplicate, other station excluded',()=>{
  const row={id:'pay1',station_id:LILOAN_STATION_ID,business_date:'2026-09-24',shift:'Shift 3',paid_at:'2026-09-23T22:15:00+08:00',status:'PAID',base_amount:500,customer_paid:550};
  const po={...row,id:'po1',status:'POSTED',shift_id:'shift-3',transaction_at:'2026-09-23T22:15:00+08:00',amount:100,liters:2};
  const result=normalizeSources({pay:[row,row,{...row,id:'other',station_id:'other'}],po:[po,po]},'2026-09-23');
  assert.equal(result.pay.length,1);assert.equal(result.pay[0].amount,500);assert.equal(result.pay[0].date,'2026-09-23');assert.equal(result.po.length,1);
  assert.throws(()=>normalizeSources({pay:[row,{...row,base_amount:1}]},'2026-09-23'),/Conflicting duplicate/);
});
test('Source connection errors reject instead of reporting zero deductions',async()=>{
  const query=new Proxy({}, {get:(_target,key)=>key==='then'?(resolve=>resolve({error:{message:'offline'}})):key==='range'?async()=>({error:{message:'offline'}}):()=>query});
  const db={from:()=>query};await assert.rejects(loadSources(db,db,'2026-09-23','2026-09-23'),/unavailable/);
});
test('Unexplained source disappearance retains the observed release for review',()=>{
  const {state,key}=fixture();const cv={id:'cv1',reference:'CV1',branch:'Liloan',date:'2026-09-23',shiftId:'shift-1',amount:100};state.cvCashEvents=[cv];
  reconcileSources(state,{pay:[],po:[],cvCashEvents:[],sourceFingerprint:'test'});
  assert.deepEqual(state.cvCashEvents,[cv]);assert.equal(state.sourceAlerts[0].reportKey,key);
});

test('All three imports obey Accounting boundaries; checkout and status labels cannot move cash',()=>{
  const times=[['03:59:59','2026-09-22','shift-3'],['04:00:00','2026-09-23','shift-1'],['12:59:59','2026-09-23','shift-1'],['13:00:00','2026-09-23','shift-2'],['13:01:00','2026-09-23','shift-2'],['21:59:59','2026-09-23','shift-2'],['22:00:00','2026-09-23','shift-3'],['00:01:00','2026-09-22','shift-3']];
  for(const [time,date,shiftId] of times) {
    const timestamp=`2026-09-23T${time}+08:00`;
    const result=normalizeSources({
      pay:[{id:'pay',station_id:LILOAN_STATION_ID,status:'PAID',base_amount:10,paid_at:timestamp,business_date:'2000-01-01',shift:'Shift 1'}],
      po:[{id:'po',station_id:LILOAN_STATION_ID,status:'POSTED',amount:10,liters:1,transaction_at:timestamp,business_date:'2000-01-01',shift_id:'shift-1'}],
      cv:[{id:'cv',station:'liloan',status:'cleared',payment_method:'cash',amount:10,decided_at:timestamp,cleared_at:'2026-09-30T15:00:00+08:00',category:{name:'OPEX'},purpose:'Test'}],
    },'2026-09-22');
    for(const rows of [result.pay,result.po,result.cvCashEvents]) assert.deepEqual({date:rows[0].date,shiftId:rows[0].shiftId},{date,shiftId},time);
  }
  assert.deepEqual(accountingTiming('2026-09-23T05:01:00Z'),{date:'2026-09-23',shiftId:'shift-2'});
  assert.throws(()=>accountingTiming('2026-09-23T13:01:00'),/timezone/);
});

test('Gateway evidence prevents delayed notifications from moving payments to another shift',()=>{
  const time='2026-09-23T04:59:59.000Z',seconds=Date.parse(time)/1000;
  const resource={type:'checkout_session',attributes:{payments:[{attributes:{status:'paid',paid_at:seconds}}]}};
  for(const raw of [{data:resource},{data:{attributes:{data:resource}}},{data:{data:resource}}]) assert.equal(verifiedPaymentTime({paid_at:time,raw_webhook:raw}),time);
  assert.throws(()=>verifiedPaymentTime({paid_at:'2026-09-23T05:01:00Z',raw_webhook:{data:resource}}),/differs/);
  assert.throws(()=>verifiedPaymentTime({paid_at:time,raw_webhook:{data:{attributes:{status:'paid'}}}}),/missing/);
  assert.throws(()=>verifiedPaymentTime({paid_at:time,raw_webhook:{data:{...resource,attributes:{...resource.attributes,paid_at:seconds+60}}}}),/conflicting/);
});
