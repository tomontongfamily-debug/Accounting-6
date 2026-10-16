import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStorePages,clearStorePageCache } from '../src/store-pages.js';
test('targeted refresh merges changes, retains history and fully replaces data across roles',async()=>{
 clearStorePageCache();const calls=[];let n=0;
 const post=async input=>{
  calls.push(input);n++;
  return n===1?{reportRows:[{report_key:'old',data:{notes:'history'}},{report_key:'new',data:{notes:'before'}}],priceRows:[{price:1}],storeRevision:10,storeScope:'Cashier',delta:false}
   :n===2?{reportRows:[{report_key:'new',data:{notes:'after'}}],priceRows:[{price:2}],storeRevision:11,storeScope:'Cashier',delta:true}
   :{reportRows:[{report_key:'old',data:{confirmed:true}}],priceRows:[],storeRevision:11,storeScope:'Approver',delta:false};
 };
 await loadStorePages(post,undefined,{cacheKey:'session'});
 const next=await loadStorePages(post,undefined,{cacheKey:'session'});
 assert.equal(calls[1].sinceRevision,10);assert.equal(next.reportRows.length,2);assert.equal(next.reportRows.find(r=>r.report_key==='new').data.notes,'after');
 const restricted=await loadStorePages(post,undefined,{cacheKey:'session'});
 assert.equal(restricted.reportRows.length,1);assert.equal(restricted.reportRows[0].data.notes,undefined);
});
test('interrupted paged refresh cannot publish a partial cache',async()=>{
 clearStorePageCache();const initial={reportRows:[{report_key:'old'}],priceRows:[],storeRevision:1,storeScope:'Admin',delta:false};
 await loadStorePages(async()=>initial,undefined,{cacheKey:'session'});
 await assert.rejects(loadStorePages(async input=>input.after?Promise.reject(Error('offline')):{reportRows:[{report_key:'new'}],priceRows:[],nextCursor:'new',storeRevision:2,storeScope:'Admin',delta:true},undefined,{cacheKey:'session'}),/offline/);
 let since;await loadStorePages(async input=>{since=input.sinceRevision;return {...initial,reportRows:[],delta:true};},undefined,{cacheKey:'session'});assert.equal(since,1);
});
