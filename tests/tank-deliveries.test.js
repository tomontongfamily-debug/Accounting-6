import test from 'node:test';
import assert from 'node:assert/strict';
import {newTankDelivery,tankDeliveryError,sameTankDelivery,mergeDeliverySave,newTankDeliveryLoad,tankDeliveryLoadError,deliveryLoadEntries,groupTankDeliveries} from '../src/tank-deliveries.js';

const delivery=newTankDelivery({driverName:'  Juan   Cruz ',product:'Diesel',liters:'3000',time:'10:30'},'delivery-1');
test('one delivery includes all delivered fuels under one driver and time, leaving unused fuels blank',()=>{
 const load=newTankDeliveryLoad({driverName:'Juan Cruz',time:'10:30',litersByProduct:{Regular:'5000',Diesel:'1000',Premium:'2000'}},'load-1');
 assert.equal(tankDeliveryLoadError(load),'');assert.equal(load.items.length,3);
 const rows=deliveryLoadEntries(load);assert.equal(new Set(rows.map(row=>row.id)).size,3);assert.ok(rows.every(row=>row.deliveryId==='load-1'));
 const groups=groupTankDeliveries([...rows,{id:'legacy',product:'Diesel',liters:10,time:'08:00',reference:'DR-123'}]);
 assert.equal(groups.length,2);assert.equal(groups[0].driverName,'Juan Cruz');assert.equal(groups[0].items.reduce((sum,row)=>sum+row.liters,0),8000);assert.equal(groups[1].reference,'DR-123');
 const single=newTankDeliveryLoad({driverName:'Juan',time:'10:30',litersByProduct:{Regular:'',Diesel:'500',Premium:'0'}},'single');
 assert.deepEqual(single.items,[{product:'Diesel',liters:500}]);assert.equal(tankDeliveryLoadError(single),'');
 for(const patch of [{items:[]},{items:[{product:'Diesel',liters:1},{product:'Diesel',liters:2}]},{items:[{product:'Regular',liters:-1}]},{driverName:''},{time:'25:00'}])assert.ok(tankDeliveryLoadError({...load,...patch}));
 assert.ok(tankDeliveryLoadError(newTankDeliveryLoad({driverName:'Juan',time:'10:30',litersByProduct:{Diesel:'bad'}},'bad')));
});
test('simple deliveries require a driver, fuel, positive liters and a real time; legacy references still work',()=>{
 assert.equal(tankDeliveryError(delivery),'');assert.equal(delivery.driverName,'Juan Cruz');assert.equal(delivery.reference,'');
 for(const patch of [{driverName:''},{product:''},{liters:0},{liters:'bad'},{time:'24:00'},{time:'10:60'},{id:''}])assert.ok(tankDeliveryError({...delivery,...patch}));
 assert.equal(tankDeliveryError({product:'Diesel',liters:10,time:'08:00',reference:'DR-123'}),'');
});
test('late delivery receipts cannot remove later deliveries or rewind newer photo revisions',()=>{
 const original={branch:'Barili',date:'2026-11-05',shiftId:'shift-1',pilotRevision:1,pilotLastNonReadingRevision:1,deliveries:[delivery],tankRows:[{tank:'Diesel',product:'Diesel',delivery:3000}]};
 const later={...original,pilotRevision:2,pilotLastNonReadingRevision:2,deliveries:[delivery,{...delivery,id:'second',time:'14:30'}],tankRows:[{tank:'Diesel',product:'Diesel',delivery:6000}]};
 assert.equal(mergeDeliverySave(later,{report:original,previousNonReadingRevision:0}),later);
 const photos={...original,pilotRevision:3,pilotLastNonReadingRevision:0,deliveries:[],tankRows:[{tank:'Diesel',product:'Diesel',delivery:0}]};
 const merged=mergeDeliverySave(photos,{report:original,previousNonReadingRevision:0});
 assert.equal(merged.pilotRevision,3);assert.equal(merged.pilotLastNonReadingRevision,1);assert.equal(merged.tankRows[0].delivery,3000);
});
test('duplicate retries are detected without preventing a driver returning with another load',()=>{
 assert.equal(sameTankDelivery(delivery,{...delivery,id:'retry',driverName:'juan cruz'}),true);
 assert.equal(sameTankDelivery(delivery,{...delivery,id:'next',time:'14:00'}),false);
 assert.equal(sameTankDelivery(delivery,{...delivery,id:'next'},{sameDate:false}),false);
 assert.equal(sameTankDelivery(delivery,{...delivery,time:'14:00'},{sameDate:false}),true);
 assert.equal(sameTankDelivery({product:'Diesel',reference:'DR-1'},{product:'Diesel',reference:' dr-1 '},{sameDate:false}),true);
});
test('delivery responses merge stock received while retaining local dips, cash and pump evidence',()=>{
 const base={branch:'Barili',date:'2026-11-05',shiftId:'shift-1',pilotRevision:4,pilotLastNonReadingRevision:4,tankRows:[{tank:'Diesel',product:'Diesel',delivery:0,actualDip:'2345'}],cashDenominations:{1000:5},notes:'Typed locally',pumpRows:[{photo_path:'phone-photo'}]};
 const saved={...base,pilotRevision:5,pilotLastNonReadingRevision:5,deliveries:[delivery],tankRows:[{tank:'Diesel',product:'Diesel',delivery:3000,actualDip:0}],notes:'Server notes'};
 const merged=mergeDeliverySave(base,{report:saved,previousNonReadingRevision:4});
 assert.equal(merged.tankRows[0].delivery,3000);assert.equal(merged.tankRows[0].actualDip,'2345');assert.equal(merged.notes,'Typed locally');
 assert.equal(merged.pilotRevision,5);assert.deepEqual(merged.pumpRows,base.pumpRows);assert.deepEqual(merged.cashDenominations,base.cashDenominations);
 assert.equal(mergeDeliverySave(base,{report:{...saved,branch:'Mabolo'}}),base);
 assert.equal(mergeDeliverySave(base,{report:saved,previousNonReadingRevision:5}).pilotRevision,4,'Never rebase across another device manual edit');
});
