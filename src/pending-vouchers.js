// Approval visibility never supplies deductions. Only approved CV imports do that.
export function pendingVouchersForReport(state,report) {
  const rows=[],unassigned=[];
  for(const voucher of state.cvPendingVouchers||[]) {
    if(voucher.branch!==report.branch||report.baselineReport)continue;
    const explicit=Array.isArray(voucher.fundingAllocations)&&voucher.fundingAllocations.length>0;
    const parts=explicit?voucher.fundingAllocations:[{date:voucher.date,shiftId:voucher.shiftId,amount:voucher.amount}];
    const valid=parts.length<=(explicit?2:1)&&parts.every(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&['shift-1','shift-2','shift-3'].includes(p.shiftId)&&Number.isFinite(Number(p.amount))&&Number(p.amount)>0)
      &&new Set(parts.map(p=>p.date+':'+p.shiftId)).size===parts.length
      &&Math.round(parts.reduce((n,p)=>n+Number(p.amount),0)*100)===Math.round(voucher.amount*100);
    if(!valid){if(voucher.date===report.date)unassigned.push({reference:voucher.reference,amount:voucher.amount,paymentType:voucher.paymentType});continue;}
    for(const part of parts)if(part.date===report.date&&part.shiftId===report.shiftId)rows.push({sourceVoucherId:voucher.id,reference:voucher.reference,amount:Number(part.amount),totalAmount:voucher.amount,paymentType:voucher.paymentType,date:part.date,shiftId:part.shiftId});
  }
  rows.sort((a,b)=>a.reference.localeCompare(b.reference));
  const cents=type=>Math.round(rows.filter(r=>r.paymentType===type).reduce((n,r)=>n+r.amount,0)*100)/100;
  const verified=Array.isArray(state.cvPendingVouchers)&&Number.isFinite(Date.parse(state.sourcesVerifiedAt));
  return {status:verified?(Date.now()-Date.parse(state.sourcesVerifiedAt)>120000?'stale':'verified'):'unavailable',verifiedAt:state.sourcesVerifiedAt||null,rows,unassigned,cashTotal:cents('cash'),fuelTotal:cents('fuel')};
}
