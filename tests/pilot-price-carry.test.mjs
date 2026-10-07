import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './pilot-fixture.mjs';
import { runAction } from '../pilot/service.mjs';
import { createReport, compute, getEffectivePricing, reportKey } from '../src/accounting-engine.js';
import { midShiftPumpKey } from '../src/mid-shift-price-change.js';
import { midShiftSalesBreakdown } from '../src/mid-shift-sales-breakdown.js';
const selling=p=>Object.fromEntries(['Premium','Regular','Diesel'].map(k=>[k,p[k]]));

function prepared() {
  const f=fixture(),prices={Premium:80,Regular:80,Diesel:80};
  f.state.priceBook.Liloan={'2026-09-22':prices};
  f.report.prices={...prices};
  f.report.pumpRows=f.report.pumpRows.map(r=>({...r,closing:Number(r.opening)+20,closingEntered:true}));
  f.report.midShiftPriceChanges=['Premium','Regular','Diesel'].map((product,index)=>{
    const c={id:product,product,effectiveTime:`09:0${index}`,newPrice:85,photoRequired:true,readings:{},readingPhotos:{}};
    for(const row of f.report.pumpRows.filter(r=>r.product===product)){
      const pumpKey=midShiftPumpKey(row),path='/api/pilot/photo?id=carry-'+row.id;
      c.readings[pumpKey]=Number(row.opening)+5;c.readingPhotos[pumpKey]={photo_path:path,readingConfirmed:true};
      f.state.photos[path]={branch:'Liloan',reportKey:f.key,rowId:row.id,changeId:c.id,product,effectiveTime:c.effectiveTime};
    }
    return c;
  });
  f.state.reports[f.key]=f.report;
  for(const [date,shift] of [['2026-09-23','shift-2'],['2026-09-23','shift-3'],['2026-09-24','shift-1']]){
    const r=createReport('Liloan',date,prices,shift);f.state.reports[reportKey('Liloan',date,shift)]=r;
  }
  return f;
}

test('confirmations atomically carry all three fuels into the next shift and next day',async()=>{
  const {state:initial,key,manager}=prepared();let state=initial;
  const history=structuredClone(state.reports['Liloan__2026-09-22__shift-3']);
  for(const product of ['Regular','Diesel','Premium']){
    const out=await runAction(state,manager,'/api/demo/midshift-confirm',{reportKey:key,changeId:product});state=out.state;
    assert.ok(out.result.report.midShiftPriceChanges.find(c=>c.product===product).confirmedAt);
    assert.equal(state.priceBook.Liloan['2026-09-23'][product],85);
  }
  assert.deepEqual(selling(state.priceBook.Liloan['2026-09-23']),{Premium:85,Regular:85,Diesel:85});
  assert.deepEqual(state.reports[key].midShiftBasePrices,{Premium:80,Regular:80,Diesel:80});
  assert.deepEqual(state.reports['Liloan__2026-09-22__shift-3'],history);
  for(const [date,shift] of [['2026-09-23','shift-2'],['2026-09-23','shift-3'],['2026-09-24','shift-1']]){
    assert.deepEqual(selling(getEffectivePricing(state.priceBook,'Liloan',date,shift).prices),{Premium:85,Regular:85,Diesel:85});
    assert.deepEqual(selling(state.reports[reportKey('Liloan',date,shift)].prices),{Premium:85,Regular:85,Diesel:85});
  }
  const retry=await runAction(state,manager,'/api/demo/midshift-confirm',{reportKey:key,changeId:'Regular'});
  assert.equal(retry.changed,false);assert.deepEqual(retry.state,state);
  const stale=await runAction(state,manager,'/api/prices/save',{branch:'Liloan',date:'2026-09-23',coverage:'Daily',prices:{Premium:80,Regular:80,Diesel:85}});
  assert.deepEqual(selling(stale.result.prices),{Premium:85,Regular:85,Diesel:85});
  const deliberate=await runAction(stale.state,manager,'/api/prices/save',{branch:'Liloan',date:'2026-09-23',coverage:'Daily',pricePatch:{Regular:86}});
  assert.deepEqual(selling(deliberate.result.prices),{Premium:85,Regular:86,Diesel:85});
  const costs=await runAction(deliberate.state,{role:'Admin'},'/api/prices/save',{branch:'Liloan',date:'2026-09-23',coverage:'Daily',pricePatch:{RegularCost:75}});
  assert.equal(costs.result.prices.Regular,86);assert.equal(costs.result.prices.RegularCost,75);
});

test('confirmation requires every photo and permits only the manager of the station',async()=>{
  const {state,key,manager,cashier}=prepared();
  await assert.rejects(runAction(state,cashier,'/api/demo/midshift-confirm',{reportKey:key,changeId:'Regular'}),/role/);
  const row=state.reports[key].pumpRows.find(r=>r.product==='Regular');
  delete state.reports[key].midShiftPriceChanges.find(c=>c.id==='Regular').readingPhotos[midShiftPumpKey(row)];
  await assert.rejects(runAction(state,manager,'/api/demo/midshift-confirm',{reportKey:key,changeId:'Regular'}),/Photograph/);
  assert.equal(state.priceBook.Liloan['2026-09-23'],undefined);
});

test('confirming an earlier price later cannot roll back a later effective change',async()=>{
  const {state:initial,key,manager}=prepared();
  const earlier=initial.reports[key].midShiftPriceChanges.find(c=>c.id==='Regular');
  const later={...structuredClone(earlier),id:'Regular-later',effectiveTime:'10:00',newPrice:90};
  for(const row of initial.reports[key].pumpRows.filter(r=>r.product==='Regular')){
    const k=midShiftPumpKey(row),path='/api/pilot/photo?id=later-'+row.id;
    later.readings[k]=Number(row.opening)+10;later.readingPhotos[k]={photo_path:path,readingConfirmed:true};
    initial.photos[path]={branch:'Liloan',reportKey:key,rowId:row.id,changeId:later.id,product:'Regular',effectiveTime:'10:00'};
  }
  initial.reports[key].midShiftPriceChanges.push(later);
  const first=await runAction(initial,manager,'/api/demo/midshift-confirm',{reportKey:key,changeId:later.id});
  const second=await runAction(first.state,manager,'/api/demo/midshift-confirm',{reportKey:key,changeId:earlier.id});
  assert.equal(second.state.priceBook.Liloan['2026-09-23'].Regular,90);
});

for(const boundary of ['opening','closing'])test(`a price-change reading at the ${boundary} matches the sales breakdown`,()=>{
  const {report}=prepared();report.midShiftBasePrices={Premium:80,Regular:80,Diesel:80};
  const change=report.midShiftPriceChanges.find(c=>c.product==='Regular');
  for(const row of report.pumpRows.filter(r=>r.product==='Regular'))change.readings[midShiftPumpKey(row)]=Number(row[boundary]);
  const expected=report.pumpRows.filter(r=>r.product==='Regular').length*20*(boundary==='opening'?85:80);
  assert.equal(compute(report).fuelSalesByProduct.Regular,expected);
  assert.equal(midShiftSalesBreakdown(report).filter(r=>r.product==='Regular').reduce((a,r)=>a+r.sales,0),expected);
});
