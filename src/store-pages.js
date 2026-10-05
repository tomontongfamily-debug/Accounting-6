// Assemble a complete store before displaying any report status. This also
// accepts older servers that return the complete store in one response.
export async function loadStorePages(post) {
  const reportRows=[],priceRows=[],seen=new Set();
  let after='';
  for(;;){
    const page=await post({paged:true,...(after?{after}:{})});
    if(!Array.isArray(page.reportRows)||!Array.isArray(page.priceRows))throw Error('Unable to verify all saved reports. Please retry.');
    reportRows.push(...page.reportRows);priceRows.push(...page.priceRows);
    if(!page.nextCursor)return {reportRows,priceRows};
    if(typeof page.nextCursor!=='string'||page.nextCursor!==page.reportRows.at(-1)?.report_key||seen.has(page.nextCursor))throw Error('Unable to verify all saved report pages. Please retry.');
    seen.add(page.nextCursor);after=page.nextCursor;
  }
}
