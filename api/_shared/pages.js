// Every page must recreate the same filtered, uniquely ordered query. A failed
// later page must fail the load rather than make saved reports appear missing.
export async function allPages(makeQuery) {
  const rows=[];
  for(let offset=0;;offset+=1000) {
    const {data,error}=await makeQuery().range(offset,offset+999);
    if(error)throw error;
    if(!Array.isArray(data))throw Error('Unable to verify complete online records.');
    rows.push(...data);
    if(data.length<1000)return rows;
  }
}
