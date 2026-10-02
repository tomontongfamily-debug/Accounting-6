export type Reading = { id: string; pump: string; nozzle: string; product: string; opening: number | string; closing: number | string; closingEntered?: boolean; photo_path?: string; readingConfirmed?: boolean; ocr_detected_reading?: number | null; ocr_was_edited?: boolean; recentLiters?: number[]; safetyMaximum?: number };
export type Issue = { category: string; detail: string };
export type CoveredReport = { key: string; branch: string; date: string; shiftId: string; cash: number; confirmed: boolean };
export type Adjustment = { type: string; amount: number; note?: string };
export type Deposit = { id: string; branch: string; depositDate: string; bank: string; reference: string; coveredReportKeys: string[]; carryoverSourceIds: string[]; coveredCash: number; previousCarryover: number; adjustments: Adjustment[]; expected: number; amount: number; unexplainedDifference: number; carryoverRemaining: number; partial: boolean; note: string; status: 'pending' | 'verified' | 'rejected'; manager: string; rejectionReason?: string };
export type Transaction = { id: string; branch: string; date: string; shiftId: string; amount: number; status: string };
export const ERROR_CATEGORIES = ['CASH_VARIANCE','PUMP_READING','PUMP_OCR_CORRECTION','ONLINE_PAY','PO','REDEMPTION','MANUAL_DEDUCTION','FUEL_PRICE','MID_SHIFT_PRICE','TANK_DELIVERY','BANK_DEPOSIT','BANK_VERIFIER','OTHER'];
export function money(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
export const CASH_DENOMINATIONS = [1000,500,200,100,50,20,10,5,1];
export function denominationTotal(counts: Record<string, unknown>): number {
  if(!counts || typeof counts!=='object' || Array.isArray(counts) || !Object.values(counts).some(v=>v!==''&&v!=null)) throw new Error('Enter the number of notes or coins counted. Enter 0 if there is no cash.');
  let total=0;
  for(const [denomination,count] of Object.entries(counts)) {
    if(!CASH_DENOMINATIONS.map(String).includes(denomination)) throw new Error('Unsupported cash denomination.');
    if(count===''||count==null) continue;
    if(!/^(0|[1-9]\d*)$/.test(String(count)) || typeof count==='boolean' || Number(count)>1000000) throw new Error('Quantities must be whole numbers from 0 to 1,000,000.');
    total+=Number(denomination)*Number(count);
  }
  return money(total);
}
export type StationCashVoucher = {id:string;sourceVoucherId:string;branch:string;date:string;shiftId:string;category:string;item:string;amount:number;status:string;fundingSource:string};
// Station policy: APPROVED means cash released. Imports still require the assigned accounting date and shift.
export function automaticCashVouchers(events: StationCashVoucher[], report: {branch:string;date:string;shiftId:string}) {
  const matched=new Map<string,StationCashVoucher>();
  for(const event of events) {
    if(event.branch!==report.branch||event.date!==report.date||event.shiftId!==report.shiftId||!['APPROVED','PAID'].includes(event.status.toUpperCase())||event.fundingSource!=='STATION_CASH') continue;
    if(!event.id||!event.sourceVoucherId||!['OPEX','Personal','Personnel','Construction'].includes(event.category)||!event.item.trim()||amount(event.amount)<=0) throw new Error('Incomplete station cash voucher.');
    const existing=matched.get(event.sourceVoucherId);
    if(existing&&['branch','date','shiftId','category','item','amount','fundingSource'].some(k=>existing[k as keyof StationCashVoucher]!==event[k as keyof StationCashVoucher])) throw new Error('Conflicting duplicate CV cash event.');
    matched.set(event.sourceVoucherId,event);
  }
  return [...matched.values()].map(e=>({id:`cv:${e.sourceVoucherId}`,sourceEventId:e.id,sourceVoucherId:e.sourceVoucherId,source:'FuelTech CV',category:e.category,item:e.item,amount:amount(e.amount)}));
}
export function amount(value: unknown): number {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') throw new Error('Enter a valid non-negative amount.');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e12) throw new Error('Enter a valid non-negative amount.');
  return money(number);
}
export function readingComplete(row: Reading): boolean {
  return Boolean(row.photo_path && row.readingConfirmed && row.closingEntered && row.closing !== '' && Number.isFinite(Number(row.closing)) && Number(row.closing) >= Number(row.opening));
}
export function readingWarning(row: Reading): { level: 'NORMAL' | 'UNUSUAL' | 'VERY UNUSUAL'; liters: number; message: string; blocked: boolean } {
  const liters = money(Number(row.closing) - Number(row.opening));
  if (row.closing === '' || !Number.isFinite(liters)) return { level:'VERY UNUSUAL', liters:0, message:'Enter the closing reading.', blocked:true };
  if (liters < 0) return { level:'VERY UNUSUAL', liters, message:'Closing is below opening. Review the photo or use the existing controlled correction process.', blocked:true };
  const history = (row.recentLiters || []).filter(n => Number.isFinite(n) && n >= 0);
  const average = history.length ? history.reduce((a,b) => a+b,0) / history.length : 0;
  const normalMax = history.length ? Math.max(...history) : 0;
  const very = liters > (row.safetyMaximum || 1500) || (history.length >= 3 && liters > Math.max(normalMax * 3, average * 5, 500));
  const unusual = history.length >= 3 && liters > Math.max(normalMax * 1.5, average * 2, 300);
  const level = very ? 'VERY UNUSUAL' : unusual ? 'UNUSUAL' : 'NORMAL';
  return { level, liters, blocked:false, message:level === 'NORMAL' ? 'Reading looks normal.' : `This reading means ${liters.toLocaleString('en-PH')} L sold. Please check the pump again.` };
}
// A photo with multiple numbers is ambiguous; never choose one by closeness to opening.
export function parseOcrReading(text: string): number | null {
  const tokens = text.trim().match(/\d[\d,.]*/g) || [];
  if (tokens.length !== 1 || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,3})?$/.test(tokens[0])) return null;
  const value = Number(tokens[0].replaceAll(',',''));
  return Number.isFinite(value) ? value : null;
}
export function datePlus(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date.');
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0,10) !== date) throw new Error('Invalid date.');
  value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}
export function permittedDay(date: string, noDepositDays: number[]): string {
  datePlus(date,0);
  if (new Set(noDepositDays).size >= 7 || noDepositDays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Keep at least one permitted deposit day.');
  for (let i=0;i<7;i++) {
    const next=datePlus(date,i);
    if (!noDepositDays.includes(new Date(`${next}T00:00:00Z`).getUTCDay())) return next;
  }
  throw new Error('No deposit day available.');
}
export function depositDue(report: CoveredReport, days: number[]): string {
  return permittedDay(datePlus(report.date,report.shiftId === 'shift-1' ? 0 : 1),days);
}
export function depositCoverage(reports: CoveredReport[], deposits: Deposit[], branch: string, date: string, days: number[]) {
  const reserved=new Set(deposits.filter(d => d.status !== 'rejected').flatMap(d => d.coveredReportKeys));
  const carryUsed=new Set(deposits.filter(d => d.status !== 'rejected').flatMap(d => d.carryoverSourceIds));
  const covered=reports.filter(r => r.branch===branch && r.confirmed && depositDue(r,days)<=date && !reserved.has(r.key)).sort((a,b)=>(a.date+a.shiftId).localeCompare(b.date+b.shiftId));
  const carry=deposits.filter(d => d.branch===branch && d.status==='verified' && d.depositDate<=date && d.carryoverRemaining>0 && !carryUsed.has(d.id));
  return { reports:covered, carryoverSourceIds:carry.map(d=>d.id), coveredCash:money(covered.reduce((sum,r)=>sum+r.cash,0)), previousCarryover:money(carry.reduce((sum,d)=>sum+d.carryoverRemaining,0)) };
}
export function depositAmounts(coveredCash: number, carry: number, adjustments: Adjustment[], actual: number, partial: boolean) {
  const costs=money(adjustments.reduce((sum,a)=>sum+amount(a.amount),0));
  const expected=money(amount(coveredCash)+amount(carry)-costs);
  if (expected < 0) throw new Error('Adjustments cannot exceed cash available.');
  const difference=money(expected-amount(actual));
  if (partial && difference<=0) throw new Error('A partial deposit must leave a positive balance.');
  return { expected, unexplainedDifference:partial ? 0 : difference, carryoverRemaining:partial ? difference : 0 };
}
export function automaticTransactions(rows: Transaction[], report: { branch: string; date: string; shiftId: string }) {
  const unique=new Map<string,Transaction>();
  for (const row of rows) if (row.branch===report.branch && row.date===report.date && row.shiftId===report.shiftId && ['PAID','POSTED'].includes(row.status)) {
    if (unique.has(row.id) && unique.get(row.id)?.amount !== row.amount) throw new Error('Conflicting duplicate source transaction.');
    amount(row.amount); unique.set(row.id,row);
  }
  const transactions=[...unique.values()];
  return { transactions, total:money(transactions.reduce((sum,r)=>sum+r.amount,0)), count:transactions.length };
}
export function cashNeedsRecount(counted: number, expected: number): boolean {
  const variance=money(counted-expected);
  return variance > 100 || variance < -1500;
}
export function reportIssues(report: { pumpRows: Reading[]; integrationIssues?: Issue[]; checkDetails?: Issue[] }, cashVariance: number): Issue[] {
  const issues: Issue[]=[...(report.integrationIssues || [])];
  if (cashVariance > 100 || cashVariance < -1500) issues.push({category:'CASH_VARIANCE',detail:`Physical cash variance: ${money(cashVariance).toFixed(2)}.`});
  for (const row of report.pumpRows) {
    const warning=readingWarning(row);
    if (warning.level !== 'NORMAL') issues.push({category:'PUMP_READING',detail:`${row.pump} ${row.nozzle}: ${warning.message}`});
  }
  return issues;
}
