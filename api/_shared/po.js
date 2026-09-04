export const PO_INTEGRATION_START_DATE = "2026-08-19";

const STATION_IDS = {
  Mabolo: "11111111-1111-4111-8111-111111111111",
  Arpili: "22222222-2222-4222-8222-222222222222",
  Liloan: "33333333-3333-4333-8333-333333333333",
  Pondol: "44444444-4444-4444-8444-444444444444",
  Barili: "55555555-5555-4555-8555-555555555555",
  Moalboal: "66666666-6666-4666-8666-666666666666",
};

export async function authoritativePoRowsForReport(supabase, report) {
  if (!report?.date || report.date < PO_INTEGRATION_START_DATE) return Array.isArray(report?.poRows) ? report.poRows : [];
  const stationId = STATION_IDS[report.branch];
  if (!stationId) return [];
  const { data, error } = await supabase
    .from("po_transactions")
    .select("id,transaction_number,customer_name,vehicle_name,plate_number,driver_name,fuel_type,liters,amount,email_status,transaction_at")
    .eq("station_id", stationId)
    .eq("business_date", report.date)
    .eq("shift_id", report.shiftId)
    .eq("status", "POSTED")
    .order("transaction_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(toAccountingPoRow);
}

export async function attachAuthoritativePoRows(supabase, reportRows, allowedBranch = "") {
  const eligible = (reportRows || []).filter((row) => row.report_date >= PO_INTEGRATION_START_DATE && (!allowedBranch || row.branch === allowedBranch));
  if (!eligible.length) return reportRows || [];
  const from = eligible.reduce((value, row) => row.report_date < value ? row.report_date : value, eligible[0].report_date);
  const to = eligible.reduce((value, row) => row.report_date > value ? row.report_date : value, eligible[0].report_date);
  const stationIds = allowedBranch ? [STATION_IDS[allowedBranch]] : Object.values(STATION_IDS);
  const transactions = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("po_transactions")
      .select("id,transaction_number,customer_name,vehicle_name,plate_number,driver_name,station_id,shift_id,business_date,fuel_type,liters,amount,email_status,transaction_at")
      .in("station_id", stationIds)
      .gte("business_date", from)
      .lte("business_date", to)
      .eq("status", "POSTED")
      .order("transaction_at", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    transactions.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const branchByStationId = Object.fromEntries(Object.entries(STATION_IDS).map(([branch, id]) => [id, branch]));
  const byReport = new Map();
  transactions.forEach((transaction) => {
    const key = `${branchByStationId[transaction.station_id]}__${transaction.business_date}__${transaction.shift_id}`;
    byReport.set(key, [...(byReport.get(key) || []), toAccountingPoRow(transaction)]);
  });
  return (reportRows || []).map((row) => row.report_date < PO_INTEGRATION_START_DATE ? row : {
    ...row,
    data: { ...(row.data || {}), poRows: byReport.get(row.report_key) || [], poSource: "FuelTech Pay" },
  });
}

function toAccountingPoRow(transaction) {
  return {
    id: transaction.id,
    transactionNumber: transaction.transaction_number,
    account: transaction.customer_name,
    vehicle: transaction.vehicle_name,
    plateNumber: transaction.plate_number,
    driver: transaction.driver_name || "",
    fuelType: transaction.fuel_type,
    liters: Number(transaction.liters || 0),
    amount: Number(transaction.amount || 0),
    emailStatus: transaction.email_status,
    transactionAt: transaction.transaction_at,
    source: "FuelTech Pay",
  };
}

