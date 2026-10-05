// Assemble a complete store before displaying any report status. This also
// accepts older servers that return the complete store in one response.
export async function loadStorePages(post, onProgress = () => {}, { timeoutMs = 45000 } = {}) {
  const reportRows=[],priceRows=[],seen=new Set();
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
      page = await Promise.race([post({paged:true,...(after?{after}:{})}, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if(!Array.isArray(page.reportRows)||!Array.isArray(page.priceRows))throw Error('Unable to verify all saved reports. Please retry.');
    reportRows.push(...page.reportRows);priceRows.push(...page.priceRows);
    onProgress(reportRows.length);
    if(!page.nextCursor)return {reportRows,priceRows};
    if(typeof page.nextCursor!=='string'||page.nextCursor!==page.reportRows.at(-1)?.report_key||seen.has(page.nextCursor))throw Error('Unable to verify all saved report pages. Please retry.');
    seen.add(page.nextCursor);after=page.nextCursor;
  }
}
