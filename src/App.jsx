import { useEffect, useMemo, useState } from "react";
// Im Just testing to edit this code
const BRANCHES = ["Mabolo", "Arpili", "Liloan", "Pondol", "Barili", "Moalboal"];
const FUEL_TYPES = ["Premium", "Regular", "Diesel"];
const DISCOUNT_PER_LITER = 2;
const TODAY = new Date().toISOString().slice(0, 10);
const STORE_KEY = "fueltech-official-branch-reporting-v2";
const ADMIN_PIN = "fueltechphils2026";

const CASHIER_PINS = {
  Mabolo: "1101",
  Arpili: "1102",
  Liloan: "1103",
  Pondol: "1104",
  Barili: "1105",
  Moalboal: "1106",
};

const MANAGER_PINS = {
  Mabolo: "2101",
  Arpili: "2102",
  Liloan: "2103",
  Pondol: "2104",
  Barili: "2105",
  Moalboal: "2106",
};

const PUMP_LAYOUTS = {
  Mabolo: [
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
  ],
  Arpili: [
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
  ],
  Liloan: [
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
    ["Premium", "Regular1", "Regular2", "Diesel"],
  ],
  Pondol: [
    ["Premium1", "Premium2", "Regular1", "Regular2", "Diesel1", "Diesel2"],
    ["Premium1", "Premium2", "Regular1", "Regular2", "Diesel1", "Diesel2"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
  ],
  Barili: [
    ["Premium1", "Premium2", "Regular1", "Regular2", "Diesel1", "Diesel2"],
    ["Premium1", "Premium2", "Regular1", "Regular2", "Diesel1", "Diesel2"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
  ],
  Moalboal: [
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
    ["Premium", "Regular", "Diesel"],
  ],
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function peso(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n(value));
}

function liter(value) {
  return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(n(value))} L`;
}

function dateOffset(baseDate, days) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getCurrentShift() {
  const now = new Date();
  const hour = now.getHours();
  const shiftDate = new Date(now);

  if (hour < 6) {
    shiftDate.setDate(shiftDate.getDate() - 1);
    return {
      date: shiftDate.toISOString().slice(0, 10),
      label: "Shift 3 - 10:00 PM to 6:00 AM",
    };
  }

  if (hour < 14) {
    return {
      date: now.toISOString().slice(0, 10),
      label: "Shift 1 - 6:00 AM to 2:00 PM",
    };
  }

  if (hour < 22) {
    return {
      date: now.toISOString().slice(0, 10),
      label: "Shift 2 - 2:00 PM to 10:00 PM",
    };
  }

  return {
    date: now.toISOString().slice(0, 10),
    label: "Shift 3 - 10:00 PM to 6:00 AM",
  };
}

function reportKey(branch, date) {
  return `${branch}__${date}`;
}

function productFromNozzle(nozzle) {
  const x = String(nozzle).toLowerCase();
  if (x.includes("premium")) return "Premium";
  if (x.includes("regular")) return "Regular";
  return "Diesel";
}

function defaultPrices() {
  return { Premium: 64.9, Regular: 62.4, Diesel: 58.75 };
}

function getEffectivePrice(priceBook, branch, date) {
  const branchPrices = priceBook[branch] || {};
  const dates = Object.keys(branchPrices).filter((item) => item <= date).sort();
  if (!dates.length) return defaultPrices();
  return { ...branchPrices[dates[dates.length - 1]] };
}

function buildPumpRows(branch) {
  let counter = 0;
  return (PUMP_LAYOUTS[branch] || PUMP_LAYOUTS.Mabolo).flatMap((nozzles, pumpIndex) =>
    nozzles.map((nozzle) => {
      counter += 1;
      const product = productFromNozzle(nozzle);
      const opening = 80000 + pumpIndex * 1750 + counter * 83;
      const sold = product === "Diesel" ? 105 + pumpIndex * 8 : product === "Regular" ? 84 + pumpIndex * 7 : 62 + pumpIndex * 6;
      return {
        id: uid(),
        pump: `Pump ${pumpIndex + 1}`,
        nozzle,
        product,
        opening,
        closing: opening + sold,
      };
    })
  );
}

function createReport(branch, date, prices) {
  return {
    id: uid(),
    branch,
    date,
    confirmed: false,
    confirmedAt: "",
    cashierName: "",
    coverage: "Whole Day",
    prices: { ...prices },
    pumpRows: buildPumpRows(branch),
    tankRows: [
      { id: uid(), tank: "Premium Tank", product: "Premium", opening: 4300, delivery: 0, pullOut: 0, calibration: 3, actualDip: 3820 },
      { id: uid(), tank: "Regular Tank", product: "Regular", opening: 5100, delivery: 0, pullOut: 0, calibration: 6, actualDip: 4540 },
      { id: uid(), tank: "Diesel Tank", product: "Diesel", opening: 6200, delivery: 2000, pullOut: 12, calibration: 3, actualDip: 7780 },
    ],
    deductions: {
      gcash: 14250,
      paymaya: 6200,
      card: 18900,
      discounts: 2800,
      calibrationCash: 550,
      cashRedemption: 900,
      fuelRedemption: 1225,
    },
    poRows: [
      { id: uid(), account: "ABC Construction", amount: 7050 },
      { id: uid(), account: "Village Maintenance", amount: 5304 },
    ],
    purchaseRows: [
      { id: uid(), item: "Lube oil replenishment", amount: 7050 },
      { id: uid(), item: "Station cleaning supplies", amount: 5304 },
    ],
    oilSales: 2350,
    coke: { beginning: 160, ending: 126, redemption: 9 },
    deposits: [
      { id: uid(), bank: "BDO", reference: "BDO-001", amount: 25000, verified: false },
      { id: uid(), bank: "BPI", reference: "BPI-002", amount: 13500, verified: false },
    ],
  };
}

function seedStore() {
  const priceBook = {};
  const reports = {};

  BRANCHES.forEach((branch, branchIndex) => {
    const basePrices = defaultPrices();
    priceBook[branch] = {
      [dateOffset(TODAY, -3)]: basePrices,
      [dateOffset(TODAY, -1)]: {
        Premium: basePrices.Premium + branchIndex * 0.1,
        Regular: basePrices.Regular + branchIndex * 0.1,
        Diesel: basePrices.Diesel + branchIndex * 0.1,
      },
    };

    [dateOffset(TODAY, -2), dateOffset(TODAY, -1), TODAY].forEach((date, dateIndex) => {
      const prices = getEffectivePrice(priceBook, branch, date);
      const report = createReport(branch, date, prices);
      report.oilSales += branchIndex * 150 + dateIndex * 250;
      report.pumpRows = report.pumpRows.map((row, rowIndex) => ({
        ...row,
        closing: row.closing + branchIndex * 4 + dateIndex * 12 + rowIndex,
      }));
      report.deposits = report.deposits.map((deposit, depositIndex) => ({
        ...deposit,
        amount: deposit.amount + branchIndex * 900 + dateIndex * 1200 + depositIndex * 500,
        verified: depositIndex === 0 && dateIndex < 2,
      }));
      reports[reportKey(branch, date)] = report;
    });
  });

  return { priceBook, reports };
}

function compute(report) {
  const fuelLiters = { Premium: 0, Regular: 0, Diesel: 0 };

  report.pumpRows.forEach((row) => {
    fuelLiters[row.product] += Math.max(0, n(row.closing) - n(row.opening));
  });

  const totalLiters = FUEL_TYPES.reduce((sum, product) => sum + fuelLiters[product], 0);
  const fuelSales = FUEL_TYPES.reduce((sum, product) => {
    const posPrice = Math.max(0, n(report.prices[product]) - DISCOUNT_PER_LITER);
    return sum + fuelLiters[product] * posPrice;
  }, 0);

  const poTotal = report.poRows.reduce((sum, row) => sum + n(row.amount), 0);
  const purchaseTotal = report.purchaseRows.reduce((sum, row) => sum + n(row.amount), 0);
  const deductionTotal = Object.values(report.deductions).reduce((sum, value) => sum + n(value), 0) + poTotal + purchaseTotal;
  const grossSales = fuelSales + n(report.oilSales);
  const expectedCash = grossSales - deductionTotal;
  const bankDeposit = report.deposits.reduce((sum, row) => sum + n(row.amount), 0);
  const confirmedBank = report.deposits.filter((row) => row.verified).reduce((sum, row) => sum + n(row.amount), 0);
  const pendingBank = Math.max(0, bankDeposit - confirmedBank);
  const cashVariance = bankDeposit - expectedCash;

  const pumpVariance = report.pumpRows.reduce((sum, row) => {
    const sold = n(row.closing) - n(row.opening);
    return sum + (sold < 0 ? sold : 0);
  }, 0);

  const tankRows = report.tankRows.map((row) => {
    const expectedDip = n(row.opening) + n(row.delivery) - fuelLiters[row.product] - n(row.pullOut) - n(row.calibration);
    return { ...row, expectedDip, variance: n(row.actualDip) - expectedDip };
  });

  return {
    fuelLiters,
    totalLiters,
    fuelSales,
    poTotal,
    purchaseTotal,
    deductionTotal,
    grossSales,
    expectedCash,
    bankDeposit,
    confirmedBank,
    pendingBank,
    cashVariance,
    tankRows,
    pumpVariance,
    tankVariance: tankRows.reduce((sum, row) => sum + row.variance, 0),
    cokeSold: Math.max(0, n(report.coke.beginning) - n(report.coke.ending) - n(report.coke.redemption)),
  };
}

function rangeDates(startDate, range) {
  const days = range === "1 Day" ? 1 : range === "1 Week" ? 7 : range === "1 Month" ? 30 : range === "2 Months" ? 60 : 90;
  return Array.from({ length: days }, (_, index) => dateOffset(startDate, index));
}

function datesBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!startDate || !endDate || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function summarizeReports(reports) {
  return reports.reduce((sum, report) => {
    const result = compute(report);
    FUEL_TYPES.forEach((product) => {
      sum.fuelLiters[product] += result.fuelLiters[product];
    });
    sum.totalLiters += result.totalLiters;
    sum.fuelSales += result.fuelSales;
    sum.oilSales += n(report.oilSales);
    sum.grossSales += result.grossSales;
    sum.deductions += result.deductionTotal;
    sum.expectedCash += result.expectedCash;
    sum.bankDeposit += result.bankDeposit;
    sum.confirmedBank += result.confirmedBank;
    sum.pendingBank += result.pendingBank;
    sum.cashVariance += result.cashVariance;
    sum.pumpVariance += result.pumpVariance;
    sum.poTotal += result.poTotal;
    sum.purchaseTotal += result.purchaseTotal;
    sum.tankVariance += result.tankVariance;
    sum.cokeSold += result.cokeSold;
    return sum;
  }, {
    fuelLiters: { Premium: 0, Regular: 0, Diesel: 0 },
    totalLiters: 0,
    fuelSales: 0,
    oilSales: 0,
    grossSales: 0,
    deductions: 0,
    expectedCash: 0,
    bankDeposit: 0,
    confirmedBank: 0,
    pendingBank: 0,
    cashVariance: 0,
    pumpVariance: 0,
    poTotal: 0,
    purchaseTotal: 0,
    tankVariance: 0,
    cokeSold: 0,
  });
}

function varianceClass(value, tankMode = false) {
  if (n(value) < 0) return "negative";
  if (n(value) > 0) return tankMode ? "negative" : "positive";
  return "neutral";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, type = "text" }) {
  return <input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />;
}

function NumberInput({ value, onChange }) {
  return <input type="number" value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} />;
}

function SelectInput({ value, onChange, options }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option}>{option}</option>)}
    </select>
  );
}

function Section({ title, children }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Card({ title, value, note, tone = "" }) {
  return (
    <div className={`card ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Status({ children, tone }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

function Table({ headers, children, minWidth = "760px" }) {
  return (
    <div className="table-wrap">
      <table style={{ minWidth }}>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EditableList({ title, rows, firstLabel, firstKey, total, onChange, onAdd, onDelete }) {
  function patch(id, key, value) {
    onChange(rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  }

  return (
    <Section title={title}>
      <Table headers={[firstLabel, "Amount", "Action"]} minWidth="560px">
        {rows.map((row) => (
          <tr key={row.id}>
            <td><TextInput value={row[firstKey]} onChange={(value) => patch(row.id, firstKey, value)} /></td>
            <td><NumberInput value={row.amount} onChange={(value) => patch(row.id, "amount", value)} /></td>
            <td><button className="small-danger" onClick={() => onDelete(row.id)}>Remove</button></td>
          </tr>
        ))}
        <tr className="total-row">
          <td>Total</td>
          <td>{peso(total)}</td>
          <td />
        </tr>
      </Table>
      <button className="secondary" onClick={onAdd}>Add Row</button>
    </Section>
  );
}

export default function App() {
  const [store, setStore] = useState(() => {
    try {
      const saved = window.localStorage.getItem(STORE_KEY);
      return saved ? JSON.parse(saved) : seedStore();
    } catch {
      return seedStore();
    }
  });

  const [role, setRole] = useState("Admin");
  const [branch, setBranch] = useState("Mabolo");
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [range, setRange] = useState("1 Week");
  const [summaryStartDate, setSummaryStartDate] = useState(dateOffset(TODAY, -7));
  const [summaryEndDate, setSummaryEndDate] = useState(TODAY);
  const [pin, setPin] = useState("");
  const currentShift = useMemo(() => getCurrentShift(), []);
  const [cashierAccess, setCashierAccess] = useState({});
  const [managerAccess, setManagerAccess] = useState({});
  const [adminAccess, setAdminAccess] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }, [store]);

  const effectivePrices = useMemo(() => getEffectivePrice(store.priceBook, branch, selectedDate), [store.priceBook, branch, selectedDate]);

  const activeReport = useMemo(() => {
    const key = reportKey(branch, selectedDate);
    return store.reports[key] || createReport(branch, selectedDate, effectivePrices);
  }, [store.reports, branch, selectedDate, effectivePrices]);

  const activeResult = useMemo(() => compute(activeReport), [activeReport]);
  const accessAllowed = (role === "Admin" && adminAccess) || (role === "Cashier" && cashierAccess[branch]) || (role === "Manager" && managerAccess[branch]);

  const rangeReports = useMemo(() => {
    const keys = [];
    rangeDates(selectedDate, range).forEach((date) => {
      if (role === "Admin") BRANCHES.forEach((b) => keys.push(reportKey(b, date)));
      else keys.push(reportKey(branch, date));
    });
    return keys.map((key) => store.reports[key]).filter(Boolean);
  }, [store.reports, selectedDate, range, role, branch]);

  const rangeSummary = useMemo(() => summarizeReports(rangeReports), [rangeReports]);

  const adminSummaryReports = useMemo(() => {
    const dates = datesBetween(summaryStartDate, summaryEndDate);
    const keys = [];
    dates.forEach((date) => {
      BRANCHES.forEach((item) => keys.push(reportKey(item, date)));
    });
    return keys.map((key) => store.reports[key]).filter(Boolean);
  }, [store.reports, summaryStartDate, summaryEndDate]);

  const adminSummary = useMemo(() => summarizeReports(adminSummaryReports), [adminSummaryReports]);

  function saveReport(nextReport) {
    setStore((old) => ({
      ...old,
      reports: { ...old.reports, [reportKey(nextReport.branch, nextReport.date)]: nextReport },
    }));
  }

  function patchReport(path, value) {
    const next = clone(activeReport);
    const [section, key, subKey] = path;
    if (section === "root") next[key] = value;
    else if (section === "pumpRows") next.pumpRows[key][subKey] = value;
    else if (section === "tankRows") next.tankRows[key][subKey] = value;
    else if (section === "deductions") next.deductions[key] = value;
    else if (section === "coke") next.coke[key] = value;
    saveReport(next);
  }

  function updateRows(section, rows) {
    const next = clone(activeReport);
    next[section] = rows;
    saveReport(next);
  }

  function addRow(section, row) {
    const next = clone(activeReport);
    next[section] = [...next[section], row];
    saveReport(next);
  }

  function removeRow(section, id) {
    const next = clone(activeReport);
    next[section] = next[section].filter((row) => row.id !== id);
    saveReport(next);
  }

  function patchDeposit(index, key, value) {
    const next = clone(activeReport);
    next.deposits[index][key] = value;
    saveReport(next);
  }

  function addDeposit() {
    addRow("deposits", { id: uid(), bank: "", reference: "", amount: 0, verified: false });
  }

  function confirmReport() {
    saveReport({
      ...activeReport,
      confirmed: !activeReport.confirmed,
      confirmedAt: !activeReport.confirmed ? new Date().toLocaleString() : "",
    });
  }

  function verifyDeposit(id) {
    const next = clone(activeReport);
    next.deposits = next.deposits.map((deposit) =>
      deposit.id === id ? { ...deposit, verified: !deposit.verified } : deposit
    );
    saveReport(next);
  }

  function patchEffectivePrice(product, value) {
    setStore((old) => ({
      ...old,
      priceBook: {
        ...old.priceBook,
        [branch]: {
          ...(old.priceBook[branch] || {}),
          [selectedDate]: {
            ...getEffectivePrice(old.priceBook, branch, selectedDate),
            [product]: value,
          },
        },
      },
    }));
  }

  function confirmDailyPrices() {
    const prices = getEffectivePrice(store.priceBook, branch, selectedDate);
    const nextReport = { ...activeReport, prices };
    saveReport(nextReport);
  }

  function unlock() {
    if (role === "Admin") {
      if (pin === ADMIN_PIN) {
        setAdminAccess(true);
        setPin("");
        setAuthMessage("");
      } else {
        setAuthMessage("Invalid admin PIN.");
      }
      return;
    }

    const pinMap = role === "Cashier" ? CASHIER_PINS : MANAGER_PINS;
    if (pin === pinMap[branch]) {
      if (role === "Cashier") setCashierAccess((old) => ({ ...old, [branch]: true }));
      if (role === "Manager") setManagerAccess((old) => ({ ...old, [branch]: true }));
      setPin("");
      setAuthMessage("");
    } else {
      setAuthMessage("Invalid branch PIN.");
    }
  }

  return (
    <main className="app">
      <div className="container">
        <header className="hero">
          <div>
            <div className="brand">FUELTECH PHILS</div>
            <h1>Branch Reporting and Monitoring</h1>
            <p>Daily reports, carried-forward fuel prices, bank verification, and station summaries.</p>
          </div>
          <div className="hero-card">
            <Field label="Branch"><SelectInput value={branch} onChange={setBranch} options={BRANCHES} /></Field>
            {role === "Admin" && (
              <Field label="Report Date"><TextInput type="date" value={selectedDate} onChange={setSelectedDate} /></Field>
            )}
            {role === "Cashier" && (
              <>
                <Card title="Report Date" value={currentShift.date} />
                <Card title="Active Shift" value={currentShift.label} />
              </>
            )}
          </div>
        </header>

        <div className="tabs">
          {["Cashier", "Manager", "Admin"].map((item) => (
            <button key={item} className={role === item ? "active" : ""} onClick={() => { setRole(item); setAuthMessage(""); }}>
              {item}
            </button>
          ))}
        </div>

        {!accessAllowed ? (
          <Section title={role === "Admin" ? "Admin Access" : `${role} Branch Access`}>
            <div className="pin-box">
              {role !== "Admin" && <Card title="Selected Branch" value={branch} tone="dark" />}
              {role === "Admin" && <Card title="Access Level" value="Administrator" tone="dark" />}
              <Field label={role === "Admin" ? "Admin PIN" : `${role} PIN`}><TextInput value={pin} onChange={setPin} type="password" /></Field>
              <button className="primary" onClick={unlock}>Proceed</button>
              {authMessage && <p className="error">{authMessage}</p>}
            </div>
          </Section>
        ) : (
          <>
            {role === "Cashier" && <CashierPage report={activeReport} result={activeResult} currentShift={currentShift} patchReport={patchReport} updateRows={updateRows} addRow={addRow} removeRow={removeRow} confirmReport={confirmReport} />}
            {role === "Manager" && <ManagerPage branch={branch} selectedDate={selectedDate} setSelectedDate={setSelectedDate} prices={effectivePrices} report={activeReport} result={activeResult} patchEffectivePrice={patchEffectivePrice} confirmDailyPrices={confirmDailyPrices} patchDeposit={patchDeposit} addDeposit={addDeposit} removeRow={removeRow} />}
            {role === "Admin" && <AdminPage branch={branch} selectedDate={selectedDate} report={activeReport} result={activeResult} verifyDeposit={verifyDeposit} summaryStartDate={summaryStartDate} setSummaryStartDate={setSummaryStartDate} summaryEndDate={summaryEndDate} setSummaryEndDate={setSummaryEndDate} adminSummaryReports={adminSummaryReports} adminSummary={adminSummary} />}
          </>
        )}
      </div>
    </main>
  );
}

function CashierPage({ report, result, currentShift, patchReport, updateRows, addRow, removeRow, confirmReport }) {
  return (
    <div className="stack">
      <Section title="Report Information">
        <div className="grid four">
          <Card title="Branch" value={report.branch} tone="dark" />
          <Card title="Report Date" value={currentShift.date} />
          <Card title="Active Shift" value={currentShift.label} />
          <Card title="Report Status" value={report.confirmed ? "Confirmed" : "For Confirmation"} tone={report.confirmed ? "green" : "yellow"} />
          <button className="confirm-button" onClick={confirmReport}>{report.confirmed ? "Undo Confirmation" : "Confirm Report"}</button>
        </div>
        <div className="grid two form-space">
          <Field label="Cashier Name"><TextInput value={report.cashierName} onChange={(value) => patchReport(["root", "cashierName"], value)} /></Field>
        </div>
      </Section>

      <Section title="Pump Reading Register">
        <Table headers={["Pump", "Nozzle", "Previous Shift Closing", "Current Closing", "Liters Sold"]} minWidth="900px">
          {report.pumpRows.map((row, index) => (
            <tr key={row.id}>
              <td>{row.pump}</td>
              <td>{row.nozzle}</td>
              <td><b className="read-only-value">{row.opening}</b></td>
              <td><NumberInput value={row.closing} onChange={(value) => patchReport(["pumpRows", index, "closing"], value)} /></td>
              <td><b>{liter(Math.max(0, n(row.closing) - n(row.opening)))}</b></td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Tank Inventory Register">
        <Table headers={["Tank", "Previous Shift Dip", "Delivery", "Pull-Out", "Calibration", "Current Actual Dip", "Variance"]} minWidth="980px">
          {result.tankRows.map((row, index) => (
            <tr key={row.id}>
              <td><b>{row.tank}</b></td>
              <td><b className="read-only-value">{liter(row.opening)}</b></td>
              <td><NumberInput value={row.delivery} onChange={(value) => patchReport(["tankRows", index, "delivery"], value)} /></td>
              <td><NumberInput value={row.pullOut} onChange={(value) => patchReport(["tankRows", index, "pullOut"], value)} /></td>
              <td><NumberInput value={row.calibration} onChange={(value) => patchReport(["tankRows", index, "calibration"], value)} /></td>
              <td><NumberInput value={row.actualDip} onChange={(value) => patchReport(["tankRows", index, "actualDip"], value)} /></td>
              <td><b className={varianceClass(row.variance, true)}>{liter(row.variance)}</b></td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Deductions and Non-Cash Transactions">
        <div className="grid four">
          {Object.entries(report.deductions).map(([key, value]) => (
            <Field key={key} label={key.replace(/([A-Z])/g, " $1")}><NumberInput value={value} onChange={(next) => patchReport(["deductions", key], next)} /></Field>
          ))}
        </div>
      </Section>

      <div className="grid two">
        <EditableList title="PO Accounts" rows={report.poRows} firstLabel="Account" firstKey="account" total={result.poTotal} onChange={(rows) => updateRows("poRows", rows)} onAdd={() => addRow("poRows", { id: uid(), account: "", amount: 0 })} onDelete={(id) => removeRow("poRows", id)} />
        <EditableList title="Purchase Requests" rows={report.purchaseRows} firstLabel="Particular" firstKey="item" total={result.purchaseTotal} onChange={(rows) => updateRows("purchaseRows", rows)} onAdd={() => addRow("purchaseRows", { id: uid(), item: "", amount: 0 })} onDelete={(id) => removeRow("purchaseRows", id)} />
      </div>

      <Section title="Oil Sales and Coke Count">
        <div className="grid four">
          <Field label="Oil Sales"><NumberInput value={report.oilSales} onChange={(value) => patchReport(["root", "oilSales"], value)} /></Field>
          <Field label="Coke Beginning"><NumberInput value={report.coke.beginning} onChange={(value) => patchReport(["coke", "beginning"], value)} /></Field>
          <Field label="Coke Ending"><NumberInput value={report.coke.ending} onChange={(value) => patchReport(["coke", "ending"], value)} /></Field>
          <Field label="Coke Redemption"><NumberInput value={report.coke.redemption} onChange={(value) => patchReport(["coke", "redemption"], value)} /></Field>
          <Card title="Coke Sold" value={`${result.cokeSold} pcs`} />
        </div>
      </Section>
    </div>
  );
}

function ManagerPage({ branch, selectedDate, setSelectedDate, prices, report, result, patchEffectivePrice, confirmDailyPrices, patchDeposit, addDeposit, removeRow }) {
  return (
    <div className="stack">
      <Section title="Daily Fuel Price Setup">
        <div className="grid four">
          <Card title="Branch" value={branch} tone="dark" />
          <Field label="Price Effective Date"><TextInput type="date" value={selectedDate} onChange={setSelectedDate} /></Field>
          <Card title="Pricing Basis" value="Daily" />
          <button className="confirm-button" onClick={confirmDailyPrices}>Confirm Daily Prices</button>
        </div>
        <div className="grid three form-space">
          {FUEL_TYPES.map((product) => (
            <div className="price-box" key={product}>
              <Field label={`${product} Manager Price`}><NumberInput value={prices[product]} onChange={(value) => patchEffectivePrice(product, value)} /></Field>
              <div className="price-note"><span>POS Price</span><strong>{peso(Math.max(0, n(prices[product]) - DISCOUNT_PER_LITER))}/L</strong></div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Manager Summary">
        <div className="grid four">
          <Card title="Total Liters" value={liter(result.totalLiters)} />
          <Card title="Gross Sales" value={peso(result.grossSales)} />
          <Card title="Bank Deposits" value={peso(result.bankDeposit)} />
          <Card title="Deposit Difference" value={peso(result.cashVariance)} tone={varianceClass(result.cashVariance)} />
        </div>
      </Section>

      <Section title="Bank Deposit Encoding">
        <Table headers={["Bank", "Reference", "Amount", "Verification", "Action"]} minWidth="860px">
          {report.deposits.map((deposit, index) => (
            <tr key={deposit.id}>
              <td><TextInput value={deposit.bank} onChange={(value) => patchDeposit(index, "bank", value)} /></td>
              <td><TextInput value={deposit.reference} onChange={(value) => patchDeposit(index, "reference", value)} /></td>
              <td><NumberInput value={deposit.amount} onChange={(value) => patchDeposit(index, "amount", value)} /></td>
              <td><Status tone={deposit.verified ? "green" : "yellow"}>{deposit.verified ? "Verified" : "Pending"}</Status></td>
              <td><button className="small-danger" onClick={() => removeRow("deposits", deposit.id)}>Remove</button></td>
            </tr>
          ))}
        </Table>
        <button className="secondary" onClick={addDeposit}>Add Deposit</button>
      </Section>
    </div>
  );
}

function AdminPage({ branch, selectedDate, report, result, verifyDeposit, summaryStartDate, setSummaryStartDate, summaryEndDate, setSummaryEndDate, adminSummaryReports, adminSummary }) {
  return (
    <div className="stack">
      <Section title="Admin View">
        <div className="grid four">
          <Card title="Selected Branch" value={branch} tone="dark" />
          <Card title="Selected Date" value={selectedDate} />
          <Card title="Confirmed Bank" value={peso(result.confirmedBank)} tone="green" />
          <Card title="Pending Verification" value={peso(result.pendingBank)} tone="yellow" />
          <Card title="Cash Variance" value={peso(result.cashVariance)} tone={varianceClass(result.cashVariance)} />
          <Card title="Tank Variance" value={liter(result.tankVariance)} tone={varianceClass(result.tankVariance, true)} />
        </div>
      </Section>

      <Section title="Bank Verification">
        <Table headers={["Bank", "Reference", "Amount", "Status", "Action"]} minWidth="820px">
          {report.deposits.map((deposit) => (
            <tr key={deposit.id}>
              <td>{deposit.bank}</td>
              <td>{deposit.reference}</td>
              <td><b>{peso(deposit.amount)}</b></td>
              <td><Status tone={deposit.verified ? "green" : "yellow"}>{deposit.verified ? "Verified" : "Pending"}</Status></td>
              <td><button className="small-success" onClick={() => verifyDeposit(deposit.id)}>{deposit.verified ? "Undo" : "Verify"}</button></td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Daily Station Summary">
        <div className="grid four">
          <Card title="Fuel Sales" value={peso(result.fuelSales)} />
          <Card title="Oil Sales" value={peso(report.oilSales)} />
          <Card title="Gross Sales" value={peso(result.grossSales)} tone="dark" />
          <Card title="Deductions" value={peso(result.deductionTotal)} />
          <Card title="Expected Cash" value={peso(result.expectedCash)} />
          <Card title="Bank Deposits" value={peso(result.bankDeposit)} />
          <Card title="PO Total" value={peso(result.poTotal)} />
          <Card title="Purchase Total" value={peso(result.purchaseTotal)} />
          <Card title="Coke Sold" value={`${result.cokeSold} pcs`} />
        </div>
      </Section>

      <Section title="Consolidated Summary - All Stations">
        <div className="grid three">
          <Field label="Summary Start Date"><TextInput type="date" value={summaryStartDate} onChange={setSummaryStartDate} /></Field>
          <Field label="Summary End Date"><TextInput type="date" value={summaryEndDate} onChange={setSummaryEndDate} /></Field>
          <Card title="Consolidated Scope" value="All Stations" note="Mabolo, Arpili, Liloan, Pondol, Barili, and Moalboal" tone="dark" />
          <Card title="Reports Included" value={`${adminSummaryReports.length}`} note="All stations within selected dates" />
        </div>

        <div className="grid four form-space">
          <Card title="Fuel Sales" value={peso(adminSummary.fuelSales)} />
          <Card title="Oil Sales" value={peso(adminSummary.oilSales)} />
          <Card title="Gross Sales" value={peso(adminSummary.grossSales)} tone="dark" />
          <Card title="Deductions" value={peso(adminSummary.deductions)} />
          <Card title="Expected Cash" value={peso(adminSummary.expectedCash)} />
          <Card title="Bank Deposit" value={peso(adminSummary.bankDeposit)} />
          <Card title="Confirmed Bank" value={peso(adminSummary.confirmedBank)} tone="green" />
          <Card title="Pending Verification" value={peso(adminSummary.pendingBank)} tone="yellow" />
          <Card title="Total PO" value={peso(adminSummary.poTotal)} />
          <Card title="Total PR" value={peso(adminSummary.purchaseTotal)} />
          <Card title="Cash Variance" value={peso(adminSummary.cashVariance)} tone={varianceClass(adminSummary.cashVariance)} />
          <Card title="Pump Variance" value={liter(adminSummary.pumpVariance)} tone={varianceClass(adminSummary.pumpVariance, true)} />
          <Card title="Tank Variance" value={liter(adminSummary.tankVariance)} tone={varianceClass(adminSummary.tankVariance, true)} />
          <Card title="Premium Liters" value={liter(adminSummary.fuelLiters.Premium)} />
          <Card title="Regular Liters" value={liter(adminSummary.fuelLiters.Regular)} />
          <Card title="Diesel Liters" value={liter(adminSummary.fuelLiters.Diesel)} />
          <Card title="Total Liters" value={liter(adminSummary.totalLiters)} />
          <Card title="Coke Sold" value={`${adminSummary.cokeSold} pcs`} />
        </div>
      </Section>
    </div>
  );
}
