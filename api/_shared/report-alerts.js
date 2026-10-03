import { missingReportAlerts, REPORT_ALERT_START_DATE, manilaDate } from '../../src/report-alerts.js';

export async function loadMissingReportAlerts(supabase,now=new Date()) {
  const reports=[];
  for(let from=0;;from+=1000){
    const {data,error}=await supabase.from('fueltech_reports')
      .select('branch,report_date,shift_id,confirmed:data->confirmed,baselineReport:data->baselineReport,openingSetupComplete:data->openingSetupComplete')
      .gte('report_date',REPORT_ALERT_START_DATE).lte('report_date',manilaDate(now))
      .order('report_key').range(from,from+999);
    if(error)throw error;
    reports.push(...(data||[]));if((data||[]).length<1000)break;
  }
  return missingReportAlerts({reports,now});
}
