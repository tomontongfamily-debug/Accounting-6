import test from 'node:test';
import assert from 'node:assert/strict';
import {runAction} from '../pilot/service.mjs';
import {fixture} from './pilot-fixture.mjs';
import {compute,createReport} from '../src/accounting-engine.js';

async function setup(){
 const f=fixture();f.keys=[];
 for(const [i,cash] of [40000,30000,25000].entries()){
  const r={...structuredClone(f.report),shiftId:'shift-'+(i+1),confirmed:true,actualCashCounted:cash};
  const key=`Liloan__${r.date}__${r.shiftId}`;f.state.reports[key]=r;f.keys.push(key);
 }
 f.act=async(role,route,input)=>{const out=await runAction(f.state,role,route,input,{uploadPhoto:async()=>{}});f.state=out.state;return out.result;};
 f.receipt=async()=> (await f.act(f.manager,'/api/demo/deposit-receipt',{branch:'Liloan',data:'data:image/jpeg;base64,/9j/2Q=='})).receiptPath;
 f.input=async(amounts,amount=amounts.reduce((n,a)=>n+a,0))=>({branch:'Liloan',depositDate:'2026-09-24',bank:'PNB',reference:'',allocationVersion:1,amount,receiptPath:await f.receipt(),coveredReportKeys:amounts.map((_,i)=>f.keys[i]),carryoverSourceIds:[],reportAllocations:amounts.map((amount,i)=>({reportKey:f.keys[i],amount,availableCash:[40000,30000,25000][i]})),carryoverAllocations:[],adjustments:[]});
 return f;
}

test('one receipt covers 30k + 20k + 18k; unused amounts stay available and concurrent deposits cannot reuse reserved cash',async()=>{
 const f=await setup();const input=await f.input([30000,20000,18000]);
 const original=structuredClone(f.state.reports);
 const {deposit}=await f.act(f.manager,'/api/demo/deposit-submit',input);
 assert.equal(deposit.amount,68000);assert.equal(deposit.coveredCash,68000);assert.equal(deposit.unexplainedDifference,0);
 assert.equal(deposit.carryoverRemaining,0);assert.equal(deposit.reportAllocations.length,3);assert.ok(deposit.reference.startsWith('DEP-'));
 const available=await f.act(f.manager,'/api/demo/deposits',{branch:'Liloan',date:'2026-09-24'});
 assert.deepEqual(available.coverage.reports.map(r=>r.cash),[10000,10000,7000]);
 for(const key of f.keys){assert.equal(f.state.reports[key].actualCashCounted,original[key].actualCashCounted);assert.deepEqual(f.state.reports[key].pumpRows,original[key].pumpRows);}
 const loaded=await f.act(f.admin,'/api/store/load',{});
 assert.equal(loaded.reportRows.find(r=>r.report_key===f.keys[0]).data.pilotCashAwaitingDeposit,10000);
 await assert.rejects(f.act(f.manager,'/api/demo/deposit-submit',{...input,receiptPath:await f.receipt()}),/exceeds|changed/);
 const second=await f.input([10000]);second.reportAllocations[0].availableCash=10000;
 const result=await f.act(f.manager,'/api/demo/deposit-submit',second);
 assert.equal((await f.act(f.manager,'/api/demo/deposits',{branch:'Liloan',date:'2026-09-24'})).coverage.reports.some(r=>r.key===f.keys[0]),false);
 await f.act(f.approver,'/api/demo/deposit-verify',{id:deposit.id,action:'reject',reason:'WRONG AMOUNT'});
 const restored=(await f.act(f.manager,'/api/demo/deposits',{branch:'Liloan',date:'2026-09-24'})).coverage.reports;
 assert.equal(restored.find(r=>r.key===f.keys[0]).cash,30000);
 await f.act(f.approver,'/api/demo/deposit-verify',{id:result.deposit.id,action:'confirm'});
 assert.equal(f.state.reports[f.keys[0]].depositCoverage.remaining,30000);
});

test('allocations require owned receipt, exact deposit plus fees, valid cents and current positive source balances',async()=>{
 const f=await setup();let input=await f.input([30000]);
 await assert.rejects(f.act(f.manager,'/api/demo/deposit-submit',{...input,receiptPath:'/missing'}),/receipt/);
 await assert.rejects(f.act(f.manager,'/api/demo/deposit-submit',{...input,amount:31000}),/must match/);
 await assert.rejects(f.act(f.manager,'/api/demo/deposit-submit',{...input,reportAllocations:[{...input.reportAllocations[0],amount:'0'}]}),/greater than zero/);
 await assert.rejects(f.act(f.manager,'/api/demo/deposit-submit',{...input,reportAllocations:[{...input.reportAllocations[0],amount:'100.001'}]}),/two decimal/);
 await assert.rejects(f.act(f.cashier,'/api/demo/deposit-submit',input),/role/);
 const photo=f.state.photos[input.receiptPath];f.state.photos[input.receiptPath]={...photo,branch:'Moalboal'};
 await assert.rejects(f.act(f.manager,'/api/demo/deposit-submit',input),/receipt/);f.state.photos[input.receiptPath]=photo;
 input={...input,amount:29800,adjustments:[{type:'BANK_FEE',amount:200}]};
 const {deposit}=await f.act(f.manager,'/api/demo/deposit-submit',input);assert.equal(deposit.expected,29800);
 const again=await f.input([1000]);again.reportAllocations[0].availableCash=10000;again.receiptPath=input.receiptPath;
 await assert.rejects(f.act(f.manager,'/api/demo/deposit-submit',again),/receipt/);
 const zero=await setup();zero.state.reports[zero.keys[0]].actualCashCounted=0;
 await assert.rejects(zero.act(zero.manager,'/api/demo/deposit-submit',await zero.input([1000])),/no longer available/);
});

test('legacy partial deposits and carryover remain intact while new deposits can reserve part of that balance',async()=>{
 const f=await setup();
 const legacy=(await f.act(f.manager,'/api/demo/deposit-submit',{branch:'Liloan',depositDate:'2026-09-24',bank:'PNB',reference:'OLD',amount:20000,partial:true,note:'Cash retained',coveredReportKeys:[f.keys[0]],carryoverSourceIds:[],adjustments:[]})).deposit;
 await f.act(f.approver,'/api/demo/deposit-verify',{id:legacy.id,action:'confirm'});
 const before=structuredClone(f.state.deposits[0]);
 const input={branch:'Liloan',depositDate:'2026-09-24',bank:'PNB',amount:5000,allocationVersion:1,receiptPath:await f.receipt(),coveredReportKeys:[],carryoverSourceIds:[legacy.id],reportAllocations:[],carryoverAllocations:[{depositId:legacy.id,amount:5000,availableCash:20000}],adjustments:[]};
 const next=(await f.act(f.manager,'/api/demo/deposit-submit',input)).deposit;
 assert.deepEqual(f.state.deposits[0],before);
 const available=(await f.act(f.manager,'/api/demo/deposits',{branch:'Liloan',date:'2026-09-24'})).coverage;
 assert.equal(available.carryoverBalances[0].availableCash,15000);
 await f.act(f.approver,'/api/demo/deposit-verify',{id:next.id,action:'reject',reason:'WRONG AMOUNT'});
 assert.equal((await f.act(f.manager,'/api/demo/deposits',{branch:'Liloan',date:'2026-09-24'})).coverage.carryoverBalances[0].availableCash,20000);
});

test('Moalboal terminal card amount reduces cash once, survives refresh and requires a new cash check after editing',async()=>{
 const f=fixture();const old=Object.values(f.state.reports);
 f.state.branches=['Moalboal'];f.state.priceBook.Moalboal=f.state.priceBook.Liloan;
 f.state.reports=Object.fromEntries(old.map(r=>{const next=createReport('Moalboal',r.date,r.prices,r.shiftId);Object.assign(next,{confirmed:r.confirmed,baselineConfirmed:true,cashierName:'Cashier'});next.pumpRows=next.pumpRows.map((p,i)=>({...p,opening:10000+i*1000,closing:10000+i*1000,closingEntered:true}));return [`Moalboal__${next.date}__${next.shiftId}`,next];}));
 const key='Moalboal__2026-09-23__shift-1';let report=f.state.reports[key];
 const session={role:'Cashier',branch:'Moalboal'};
 const save=await runAction(f.state,session,'/api/reports/save',{report:{...report,deductions:{...report.deductions,bankCard:760}}});
 assert.equal(save.result.report.deductions.bankCard,760);
 assert.equal(compute(save.result.report).expectedCash,-760);
 const loaded=await runAction(save.state,session,'/api/store/load');
 report=loaded.result.reportRows.find(r=>r.report_key===key).data;assert.equal(report.deductions.bankCard,760);
 assert.equal(report.onlinePay.total,0);
 const changed=await runAction(save.state,session,'/api/reports/save',{report:{...report,deductions:{...report.deductions,bankCard:900},cashReviewState:'checked'}});
 assert.equal(changed.result.report.cashReviewState,'');assert.equal(compute(changed.result.report).deductionTotal,900);
 const other=fixture();await assert.rejects(runAction(other.state,other.cashier,'/api/reports/save',{report:{...other.report,deductions:{bankCard:760}}}),/only in Moalboal/);
 const negative=await assert.rejects(runAction(save.state,session,'/api/reports/save',{report:{...report,deductions:{bankCard:-1}}}),/non-negative/);void negative;
});
