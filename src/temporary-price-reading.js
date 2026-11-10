// Owner-authorized recovery for this one existing Barili price change only.
// It never follows a newer change and never applies to opening/closing readings.
export const BARILI_MANUAL_PRICE_GRANT=Object.freeze({
  id:'barili-20261110-f5zzz9s-manual-recovery',branch:'Barili',date:'2026-11-10',shiftId:'shift-1',changeId:'f5zzz9s',product:'Premium',effectiveTime:'11:26',newPrice:91.9,
  startsAt:'2026-11-10T17:00:00+08:00',expiresAt:'2026-11-11T17:30:00+08:00',
});
const pumpKey=row=>`${row.pump}|${row.nozzle}|${row.product}`;
export function matchesTemporaryPriceGrant(report,change){
  const grant=BARILI_MANUAL_PRICE_GRANT;
  return !!report&&!!change&&!report.baselineReport&&['branch','date','shiftId'].every(key=>report[key]===grant[key])
    &&change.id===grant.changeId&&change.product===grant.product&&change.effectiveTime===grant.effectiveTime&&Number(change.newPrice)===grant.newPrice;
}
export function temporaryManualPriceOpen(report,change,now=Date.now()){
  return matchesTemporaryPriceGrant(report,change)&&!report.confirmed&&!change.confirmedAt
    &&now>=Date.parse(BARILI_MANUAL_PRICE_GRANT.startsAt)&&now<Date.parse(BARILI_MANUAL_PRICE_GRANT.expiresAt);
}
export function validTemporaryManualPriceReading(report,change,row,evidence){
  const entry=evidence?.manualEntry,value=change?.readings?.[pumpKey(row)]??change?.readings?.[row.id],recordedAt=Date.parse(entry?.recordedAt||'');
  return matchesTemporaryPriceGrant(report,change)&&row.product===change.product&&!!evidence?.readingConfirmed
    &&entry?.authorizationId===BARILI_MANUAL_PRICE_GRANT.id&&entry.rowId===row.id&&entry.pumpKey===pumpKey(row)&&['Cashier','Manager'].includes(entry.role)
    &&recordedAt>=Date.parse(BARILI_MANUAL_PRICE_GRANT.startsAt)&&recordedAt<Date.parse(BARILI_MANUAL_PRICE_GRANT.expiresAt)
    &&typeof entry.value==='number'&&Number.isFinite(entry.value)&&value!==''&&value!=null&&entry.value===Number(value)
    &&entry.value>=Number(row.opening)&&(!row.closingEntered||entry.value<=Number(row.closing));
}
