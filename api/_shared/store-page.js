import {gzipSync} from 'node:zlib';

export const STORE_PAGE_ROWS=200;
const MAX_PAGE_BYTES=2*1024*1024;
export function storePage(reportRows,priceRows) {
 const rows=[];let bytes=Buffer.byteLength(JSON.stringify(priceRows))+256;
 for(const row of reportRows){
  const size=Buffer.byteLength(JSON.stringify(row))+1;
  if(rows.length>=STORE_PAGE_ROWS||bytes+size>MAX_PAGE_BYTES)break;
  rows.push(row);bytes+=size;
 }
 if(reportRows.length&&!rows.length)throw Error('A saved report is too large to load. Admin review is required.');
 return {ok:true,reportRows:rows,priceRows,nextCursor:rows.length<reportRows.length?rows.at(-1).report_key:null};
}
export function sendStoreJson(req,res,payload) {
 // Compatibility for already-open clients requesting the complete history.
 // Browser fetch transparently decodes gzip; new clients use bounded pages.
 const encoding=req.headers['accept-encoding']||'';
 if(/\bgzip\b/i.test(encoding)&&!/\bgzip\s*;\s*q=0(?:\.0*)?(?:\s*,|\s*$)/i.test(encoding)){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');
  res.status(200).end(gzipSync(JSON.stringify(payload)));return;
 }
 res.status(200).json(payload);
}
