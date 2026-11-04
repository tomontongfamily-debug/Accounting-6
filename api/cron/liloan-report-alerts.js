import {reportAlertsHandler} from '../_shared/report-alerts-cron.js';
export default function handler(req,res) { return reportAlertsHandler(req,res,{branches:['Liloan']}); }
