export const OWNER_PERIOD_OPTIONS = ["Shift", "Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "All-time"];

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetDate(baseDate, days) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function ownerPeriodRange(period, anchorDate, accountingStartDate) {
  const anchor = new Date(`${anchorDate}T00:00:00`);
  if (Number.isNaN(anchor.getTime())) {
    return { start: accountingStartDate, end: accountingStartDate };
  }

  let start = anchorDate;
  if (period === "All-time") start = accountingStartDate;
  else if (period === "Weekly") start = offsetDate(anchorDate, -6);
  if (period === "Monthly") {
    start = `${anchorDate.slice(0, 7)}-01`;
  }
  if (period === "Quarterly") {
    const quarterStartMonth = Math.floor(anchor.getMonth() / 3) * 3 + 1;
    start = `${anchor.getFullYear()}-${String(quarterStartMonth).padStart(2, "0")}-01`;
  }
  if (period === "Yearly") start = `${anchor.getFullYear()}-01-01`;
  if (period === "All-time") start = accountingStartDate;
  return { start, end: anchorDate };
}

export function ownerReportsForPeriod(reports, range, period, shiftId) {
  const reportList = Array.isArray(reports) ? reports : Object.values(reports || {});
  return reportList.filter((report) =>
    report?.confirmed
    && String(report.date || "") >= range.start
    && String(report.date || "") <= range.end
    && (period !== "Shift" || report.shiftId === shiftId)
  );
}

function shortDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function monthLabel(monthKey, includeYear = false) {
  return new Date(`${monthKey}-01T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    year: includeYear ? "2-digit" : undefined,
  });
}

function nextMonth(monthKey) {
  const date = new Date(`${monthKey}-01T00:00:00`);
  date.setMonth(date.getMonth() + 1);
  return dateKey(date).slice(0, 7);
}

export function ownerCashTrendRows(reports, period, range, cashValue, branches, shifts) {
  const values = new Map();
  const add = (key, label, value) => {
    const current = values.get(key) || { key, label, value: 0 };
    current.value += Number(value) || 0;
    values.set(key, current);
  };

  reports.forEach((report) => {
    if (period === "Shift") {
      add(report.branch, report.branch, cashValue(report));
      return;
    }
    if (period === "Daily") {
      const shift = shifts.find((item) => item.id === report.shiftId);
      add(report.shiftId, shift?.shortLabel || report.shiftId, cashValue(report));
      return;
    }
    if (period === "Weekly") {
      add(report.date, shortDate(report.date), cashValue(report));
      return;
    }
    if (period === "Monthly") {
      const week = Math.ceil(Number(report.date.slice(8, 10)) / 7);
      add(`${report.date.slice(0, 7)}-W${week}`, `Week ${week}`, cashValue(report));
      return;
    }
    const monthKey = report.date.slice(0, 7);
    add(monthKey, monthLabel(monthKey, period === "All-time"), cashValue(report));
  });

  if (period === "Shift") {
    return branches.map((branch) => values.get(branch) || { key: branch, label: branch, value: 0 });
  }
  if (period === "Daily") {
    return shifts.map((shift) => values.get(shift.id) || { key: shift.id, label: shift.shortLabel, value: 0 });
  }
  if (period === "Weekly") {
    const rows = [];
    let date = range.start;
    while (date <= range.end) {
      rows.push(values.get(date) || { key: date, label: shortDate(date), value: 0 });
      date = offsetDate(date, 1);
    }
    return rows;
  }
  if (period === "Monthly") {
    const endDay = Number(range.end.slice(8, 10));
    const weekCount = Math.max(1, Math.ceil(endDay / 7));
    const monthKey = range.end.slice(0, 7);
    return Array.from({ length: weekCount }, (_, index) => {
      const week = index + 1;
      const key = `${monthKey}-W${week}`;
      return values.get(key) || { key, label: `Week ${week}`, value: 0 };
    });
  }

  const rows = [];
  let monthKey = range.start.slice(0, 7);
  const endMonth = range.end.slice(0, 7);
  while (monthKey <= endMonth) {
    rows.push(values.get(monthKey) || {
      key: monthKey,
      label: monthLabel(monthKey, period === "All-time"),
      value: 0,
    });
    monthKey = nextMonth(monthKey);
  }
  return rows;
}
