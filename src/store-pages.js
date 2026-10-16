// Assemble a complete store before displaying any report status. This also
// accepts older servers that return the complete store in one response.
const verifiedStores=new Map();
export function clearStorePageCache(){verifiedStores.clear();}
export async function loadStorePages(post, onProgress = () => {}, { timeoutMs = 45000, cacheKey = '' } = {}) {
  const reportRows=[],priceRows=[],seen=new Set();
  const cached=cacheKey?verifiedStores.get(cacheKey):null;
  let revision,scope,delta;
  let after='';
  for(;;){
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Loading reports took too long. Please try again.'));
        controller.abort();
      }, timeoutMs);
    });
    let page;
    try {
      page = await Promise.race([post({paged:true,...(after?{after}:{}),...(cached?{sinceRevision:cached.revision,storeScope:cached.scope}:{})}, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if(!Array.isArray(page.reportRows)||!Array.isArray(page.priceRows))throw Error('Unable to verify all saved reports. Please retry.');
    if(revision!==undefined&&(revision!==page.storeRevision||scope!==page.storeScope||delta!==page.delta))throw Error('Reports changed while loading. Please refresh again.');
    revision=page.storeRevision;scope=page.storeScope;delta=page.delta;
    reportRows.push(...page.reportRows);priceRows.push(...page.priceRows);
    onProgress(reportRows.length);
    if(!page.nextCursor){
      let result={reportRows,priceRows};
      if(delta){
        if(!cached||cached.scope!==scope)throw Error('The station session changed. Please refresh again.');
        const reports=new Map(cached.result.reportRows.map(row=>[row.report_key,row]));
        reportRows.forEach(row=>reports.set(row.report_key,row));
        result={reportRows:[...reports.values()],priceRows};
      }
      if(cacheKey&&Number.isSafeInteger(revision)&&typeof scope==='string'){
        verifiedStores.clear(); // No history survives a different account/store.
        verifiedStores.set(cacheKey,{revision,scope,result:structuredClone(result)});
      }
      return result;
    }
    if(typeof page.nextCursor!=='string'||page.nextCursor!==page.reportRows.at(-1)?.report_key||seen.has(page.nextCursor))throw Error('Unable to verify all saved report pages. Please retry.');
    seen.add(page.nextCursor);after=page.nextCursor;
  }
}
