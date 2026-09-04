const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const guideDir = path.join(root, "guides", "printable");
const pdfDir = path.join(root, "output", "pdf");
const tempDir = path.join(root, "tmp", "pdfs");
fs.mkdirSync(guideDir, { recursive: true });
fs.mkdirSync(pdfDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

const icon = (text) => `<span class="icon">${text}</span>`;
const badge = (text, tone = "") => `<span class="badge ${tone}">${text}</span>`;
const field = (label, value, ghost = false) => `
  <div class="field ${ghost ? "ghost" : ""}">
    <span>${label}</span><b>${value}</b>
  </div>`;
const callout = (title, body, tone = "info") => `
  <div class="callout ${tone}"><b>${title}</b><span>${body}</span></div>`;
const step = (number, title, body) => `
  <div class="instruction">
    <span class="step">${number}</span>
    <div><h3>${title}</h3><p>${body}</p></div>
  </div>`;
const screen = (title, body, note = "") => `
  <div class="screen">
    <div class="screen-head"><b>${title}</b>${note ? badge(note) : ""}</div>
    ${body}
  </div>`;
const page = (role, number, total, title, subtitle, body, accent = "blue") => `
  <section class="page ${accent}">
    <header>
      <div><span class="brand">FUELTECH ACCOUNTING</span><h1>${title}</h1><p>${subtitle}</p></div>
      <div class="page-no">${role}<b>${number}/${total}</b></div>
    </header>
    <main>${body}</main>
    <footer><span>FuelTech ${role} Guide</span><b>Read the screen before pressing Confirm.</b></footer>
  </section>`;

const cashierPages = [
  page("CASHIER", 1, 6, "Start The Correct Shift", "Login, shift cards, Opening Setup, and automatic saving", `
    <div class="hero-grid">
      <div>
        <h2>Your shift times</h2>
        <div class="shift-grid">
          <div class="shift-card active"><small>SHIFT 1</small><b>4:00 AM - 1:00 PM</b><span>Tap to open</span></div>
          <div class="shift-card"><small>SHIFT 2</small><b>1:00 PM - 10:00 PM</b><span>Draft / Submitted</span></div>
          <div class="shift-card"><small>SHIFT 3</small><b>10:00 PM - 4:00 AM</b><span>Missing / Submitted</span></div>
        </div>
      </div>
      ${screen("Cashier Login", `
        ${field("Branch", "Liloan")}
        ${field("Cashier PIN", "••••••")}
        <div class="button">Log In</div>
      `, "Cashier")}
    </div>
    <h2>Before entering any number</h2>
    <div class="two">
      <div>
        ${step(1, "Choose the correct branch", "Never work under another station. Stop immediately if the branch name is wrong.")}
        ${step(2, "Check the report date", "The card must show the sales date you are reporting. Do not guess yesterday/today.")}
        ${step(3, "Tap Shift 1, Shift 2, or Shift 3", "The blue ring means the selected shift. Status must match what you expect: Not Started, Draft, Missing, or Submitted.")}
        ${step(4, "Type the cashier name", "Use the real cashier who counted and submitted the shift.")}
      </div>
      ${screen("Today - Liloan", `
        <div class="mini-cards">
          <div><small>SHIFT 1</small><b>Draft</b><span>Continue Report</span></div>
          <div><small>SHIFT 2</small><b>Not Started</b><span>Start Report</span></div>
          <div><small>SHIFT 3</small><b>Submitted</b><span>Complete</span></div>
        </div>
        <div class="button secondary">Request Date Correction</div>
      `, "Shift Dashboard")}
    </div>
    <h2>Opening Setup</h2>
    <div class="two">
      ${screen("Opening Setup", `
        ${field("First Pump Reading", "Copy exact physical register")}
        ${field("First Underground Tank Dip", "Liters")}
        ${field("Coke Beginning", "Piece count")}
        <div class="button success">Confirm Opening Setup</div>
      `, "Only when instructed")}
      <div>
        ${callout("Use it once", "Opening Setup creates the starting readings when the station begins or when admin intentionally reopens it.", "good")}
        ${callout("Do not repeat it", "If Opening Setup already says complete, open the correct shift card. Ask admin before redoing setup.", "warn")}
        ${callout("Draft recovery", "Every entry is kept on the device immediately and uploaded online after a short pause. A refresh should restore the unfinished draft.", "info")}
      </div>
    </div>
  `),

  page("CASHIER", 2, 6, "Step 1 - Pump Register", "Copy every physical register reading exactly, including decimals", `
    ${screen("Step 1 of 8 - Pump Register", `
      <table>
        <thead><tr><th>Pump / Nozzle</th><th>Previous Closing</th><th>Current Closing</th><th>Liters Sold</th></tr></thead>
        <tbody>
          <tr><td><b>Pump 1 - Premium</b></td><td class="readonly">408,967.16</td><td class="input">409,019.92</td><td>52.76 L</td></tr>
          <tr><td><b>Pump 1 - Regular</b></td><td class="readonly">325,929.76</td><td class="input">326,030.05</td><td>100.29 L</td></tr>
          <tr><td><b>Pump 1 - Diesel</b></td><td class="readonly">212,631.95</td><td class="input ghost-cell">0</td><td>0.00 L</td></tr>
        </tbody>
      </table>
      <div class="wizard-nav"><span class="button secondary">Back</span><span class="button">Save & Next</span></div>
    `, "Exact physical reading")}
    <div class="two">
      <div>
        <h2>What to do</h2>
        ${step(1, "Read the pump label", "Match Pump number and nozzle: Premium, Regular, Regular 2, or Diesel.")}
        ${step(2, "Leave Previous Closing alone", "Gray fields come from the prior confirmed shift. Cashier does not edit them.")}
        ${step(3, "Tap Current Closing", "The faint zero is only a placeholder. Type the whole register number yourself.")}
        ${step(4, "Keep the decimal", "If the physical register says 409019.92, type 409019.92 - not 409019 and not 40919.92.")}
        ${step(5, "Check liters sold", "The app calculates liters. If it looks impossible, recheck the copied digits before continuing.")}
      </div>
      <div>
        <h2>Important rules</h2>
        ${callout("No sales / closed station", "Current Closing may be exactly the same as Previous Closing. That correctly produces 0 liters sold.", "good")}
        ${callout("Never invent a reading", "Copy what the physical pump shows. If it appears lower or unusually high, recheck every digit; do not change it just to remove a warning.", "warn")}
        ${callout("Do not switch products", "Premium entered under Regular can create very large sales and variance.", "bad")}
        ${callout("Typing problem?", "Click once inside the box, press Ctrl+A or Select All, then type the full number. Do not use the mouse wheel to change values.", "info")}
        <div class="example"><b>Quick check</b><span>409019.92 - 408967.16 = 52.76 liters</span></div>
      </div>
    </div>
    <div class="bottom-strip"><b>Before Next:</b> Every configured pump/nozzle is checked, decimals are present, and no Premium/Regular/Diesel row is switched.</div>
  `),

  page("CASHIER", 3, 6, "Steps 2-3 - Tank And Deductions", "Record actual underground inventory and all shift deductions", `
    <h2>Step 2 of 8 - Underground Tank</h2>
    ${screen("Underground Tank", `
      <table>
        <thead><tr><th>Product</th><th>Previous Dip</th><th>Delivery</th><th>Pull-Out</th><th>Calibration</th><th>Current Actual Dip</th></tr></thead>
        <tbody>
          <tr><td><b>Premium</b></td><td class="readonly">3,500 L</td><td class="input">0</td><td class="input">0</td><td class="input">5.00</td><td class="input">3,420.50</td></tr>
          <tr><td><b>Regular</b></td><td class="readonly">4,800 L</td><td class="input">2,000</td><td class="input">0</td><td class="input">0</td><td class="input">6,620.25</td></tr>
          <tr><td><b>Diesel</b></td><td class="readonly">5,100 L</td><td class="input">0</td><td class="input">0</td><td class="input">0</td><td class="input">5,010.75</td></tr>
        </tbody>
      </table>
    `, "Premium / Regular / Diesel")}
    <div class="three">
      <div class="tile"><b>Delivery</b><span>Liters physically received during this shift. Enter under the correct product.</span></div>
      <div class="tile"><b>Pull-Out</b><span>Liters physically removed from the tank. Do not use for sales.</span></div>
      <div class="tile"><b>Calibration</b><span>Test liters returned to the tank. Enter liters only; no calibration cash deduction.</span></div>
    </div>
    ${callout("Tank dip is a reference check", "Use the actual measured dip. Pump register sales remain the official fuel sales; the app compares them with tank movement.", "info")}
    <h2>Step 3 of 8 - Deductions</h2>
    <div class="two">
      ${screen("Payments And Redemptions", `
        ${field("FuelTech Pay Total", "Card + GCash + PayMaya")}
        ${field("Cash Redemption", "Cash value redeemed")}
        ${field("Fuel Redemption", "Fuel value redeemed")}
        ${field("Points Issued", "Points earned")}
      `)}
      <div>
        ${step(1, "FuelTech Pay Total", "Combine all approved non-cash payments for the shift. Do not include bank deposits.")}
        ${step(2, "Cash / Fuel Redemption", "Enter actual redeemed value only. Points Withdrawn is derived by the system; do not count redemption twice.")}
        ${step(3, "Other deductions", "Use only the named field that matches the real transaction. Keep receipts or supporting documents.")}
        ${callout("Bank deposits are manager work", "Never type a bank deposit into deductions, PO, PR, FuelTech Pay, or physical cash.", "bad")}
      </div>
    </div>
  `),

  page("CASHIER", 4, 6, "Steps 4-6 - PO, PR, Oil, Coke, Cash", "Enter each transaction separately and count physical cash honestly", `
    <div class="three equal">
      <div>
        <h2>Step 4 - PO and PR</h2>
        ${screen("PO Accounts", `
          ${field("Account / Customer", "Example: ABC Company")}
          ${field("Amount", "5,000.00")}
          <div class="button small">+ Add PO</div>
        `)}
        ${screen("Purchase Requests", `
          ${field("Purpose", "Example: Station supplies")}
          ${field("Amount", "2,500.00")}
          <div class="button small">+ Add PR</div>
        `)}
        ${callout("Separate rows", "Use + Add for each customer/account or purchase. Do not combine unrelated transactions.", "warn")}
      </div>
      <div>
        <h2>Step 5 - Oil and Coke</h2>
        ${screen("Oil Sales", `
          ${field("Product", "Engine Oil 1L")}
          ${field("Quantity Sold", "3")}
          ${field("Selling Price", "350.00")}
          <div class="button small">+ Add Oil Sale</div>
        `)}
        ${screen("Coke Count", `
          ${field("Coke Beginning", "24", true)}
          ${field("Coke Ending", "18")}
        `)}
        ${callout("Coke is inventory", "There is no Coke Redemption. Beginning is carried from setup/previous shift; cashier enters Ending.", "info")}
      </div>
      <div>
        <h2>Step 6 - Physical Cash</h2>
        ${screen("End-of-Shift Cash Count", `
          ${field("Physical Cash Counted", "47,190.00")}
          <div class="button small">Save & Next</div>
        `)}
        ${step(1, "Count the actual cash", "Count bills and coins physically present at end of shift.")}
        ${step(2, "Enter only what you counted", "Cashier does not see expected cash or the difference. Do not ask someone what amount to type.")}
        ${step(3, "Do not include non-cash items", "Exclude FuelTech Pay, PO, PR, bank deposits, and receipts from physical cash.")}
      </div>
    </div>
    <h2>Meaning of each amount</h2>
    <table>
      <thead><tr><th>Item</th><th>What it means</th><th>Where it goes</th></tr></thead>
      <tbody>
        <tr><td><b>PO</b></td><td>Customer/company fuel billed to an account</td><td>One PO row per account</td></tr>
        <tr><td><b>PR</b></td><td>Cash used for an approved station purchase</td><td>One PR row per purpose</td></tr>
        <tr><td><b>Physical cash counted</b></td><td>Actual bills and coins at shift end</td><td>Step 6 only</td></tr>
        <tr><td><b>Bank deposit</b></td><td>Money deposited in the bank</td><td>Manager page only</td></tr>
      </tbody>
    </table>
    <div class="bottom-strip"><b>Never force the physical cash to match.</b> Accurate counting lets admin find shortages, overages, missing deductions, or input mistakes.</div>
  `),

  page("CASHIER", 5, 6, "Steps 7-8 - Name, Review, Submit", "Confirm the responsible cashier, fix warnings, and wait for a report ID", `
    <div class="two">
      <div>
        <h2>Step 7 of 8 - Cashier Information</h2>
        ${screen("Cashier Information", `
          ${field("Cashier Name", "JUAN DELA CRUZ")}
          ${field("Report Date", "2026-07-23", true)}
          ${field("Active Shift", "Shift 1", true)}
          <div class="button">Save & Next</div>
        `, "Editable name")}
        ${step(1, "Type the full cashier name", "This identifies who counted and submitted the report.")}
        ${step(2, "Check date and active shift", "These must match the shift card you opened. Go Back if wrong.")}
      </div>
      <div>
        <h2>Step 8 of 8 - Review and Submit</h2>
        ${screen("Review and Submit", `
          <div class="review"><span>Total Liters Sold</span><b>243.80 L</b></div>
          <div class="review warn"><span>Pump 2 Regular</span><b>Unusually high - recheck</b></div>
          <div class="review"><span>Physical Cash Counted</span><b>Entered</b></div>
          <div class="button warning">Fix This Reading</div>
          <div class="button success">Submit Shift Report</div>
        `, "Final check")}
        ${step(3, "Read every summary", "Check total liters, payments, PO/PR, oil/coke, tank entries, and physical cash status.")}
        ${step(4, "Use Fix This Reading", "A yellow warning jumps to the exact pump row. Recheck the physical register and correct only if your copy is wrong.")}
      </div>
    </div>
    <h2>Final confirmation</h2>
    <div class="flow">
      <div>${icon("1")}<b>Press Submit Shift Report</b><span>Only once</span></div>
      <div>${icon("2")}<b>Read the confirmation popup</b><span>Confirm Report or Go Back</span></div>
      <div>${icon("3")}<b>Wait for Submitted</b><span>Do not close during the request</span></div>
      <div>${icon("4")}<b>Check the shift card</b><span>Must show Submitted / Complete</span></div>
    </div>
    ${callout("Successful submission", "The server returns a confirmed report ID and locks the report. Repeated clicks must not create duplicate reports.", "good")}
    ${callout("Still Draft?", "The report was not fully submitted. Stay on the page, check the message, correct the named field, then submit again.", "warn")}
    ${callout("Missing manager price?", "Wait briefly after the manager confirms prices. The cashier page checks for new prices automatically; do not erase the report.", "info")}
    ${callout("Never share PINs", "Use only your assigned cashier PIN. Press Log Out when leaving the device.", "bad")}
  `),

  page("CASHIER", 6, 6, "Missing Reports, Corrections, And Quick Sticker", "What to press when the normal shift flow cannot continue", `
    <div class="two">
      <div>
        <h2>Missing shift warning</h2>
        ${screen("Previous Shift Is Missing", `
          <p class="screen-copy">Please complete July 22, Shift 3 first so pump readings stay connected.</p>
          <div class="button warning">Go To Missing Shift</div>
        `)}
        ${step(1, "Read the exact date and shift", "Each missing shift has its own button. Do not open a different report.")}
        ${step(2, "Press Go To Missing Shift", "The app opens that specific report and records the jump for admin.")}
        ${step(3, "Complete and submit it", "Return to today only after the missing shift shows Submitted.")}
        <h2>Request Date Correction</h2>
        ${screen("Request Date Correction", `
          ${field("Correct Report Date", "2026-07-22")}
          ${field("Shift", "Shift 2")}
          ${field("Reason", "Entered wrong report date")}
          <div class="button">Send Request To Admin</div>
        `)}
        ${callout("Use only for a real correction", "The report opens only after admin approval, then locks again after the corrected submission.", "warn")}
      </div>
      <div>
        <h2>Cashier troubleshooting</h2>
        <table class="compact">
          <thead><tr><th>Problem</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td>Cannot type</td><td>Tap field once; Select All; type full number. Avoid rapid repeated clicks.</td></tr>
            <tr><td>Entry disappeared</td><td>Stay on the same branch/date/shift; wait a moment; refresh once. Draft should restore.</td></tr>
            <tr><td>Price missing</td><td>Tell manager product/date/shift. Wait for automatic price update.</td></tr>
            <tr><td>Submit button fails</td><td>Read the exact red/yellow message and fix that field. Do not make a new report.</td></tr>
            <tr><td>Wrong date/shift</td><td>Go Back before typing. If already submitted, request correction.</td></tr>
            <tr><td>Someone editing</td><td>Another device holds the report. Use the device already editing or wait for the lock to clear.</td></tr>
          </tbody>
        </table>
        <h2>Print-and-cut cashier sticker</h2>
        <div class="sticker">
          <h3>CASHIER - 8 STEPS</h3>
          <ol>
            <li>Pump Register - exact readings</li>
            <li>Underground Tank - actual dip</li>
            <li>Deductions - payments/redemptions</li>
            <li>PO and Purchase Requests - separate rows</li>
            <li>Oil and Coke - sales + ending count</li>
            <li>Physical Cash - actual bills/coins only</li>
            <li>Cashier Information - real full name</li>
            <li>Review and Submit - fix warnings, confirm once</li>
          </ol>
          <b>CHECK: Branch • Date • Shift • Decimals • Product rows • Submitted status • Log Out</b>
        </div>
      </div>
    </div>
  `),
];

const managerPages = [
  page("MANAGER", 1, 4, "Manager Start And Fuel Prices", "Choose the correct station, set prices, and confirm before cashier submits", `
    <div class="hero-grid">
      ${screen("Manager Login", `
        ${field("Branch", "Liloan")}
        ${field("Manager PIN", "••••••")}
        <div class="button">Log In</div>
      `, "Manager")}
      <div>
        <h2>Manager responsibilities</h2>
        <div class="mini-grid">
          <div>${icon("₱")}<b>Fuel prices</b><span>Daily or selected shift</span></div>
          <div>${icon("↗")}<b>Mid-shift change</b><span>Exact time/register</span></div>
          <div>${icon("B")}<b>Bank deposit</b><span>Date, coverage, reference</span></div>
          <div>${icon("H")}<b>History</b><span>Request change/removal</span></div>
        </div>
        ${callout("Role boundary", "Manager does not use cashier login, edit cashier pump readings, see cashier cash variance, or verify bank deposits for admin.", "warn")}
      </div>
    </div>
    <h2>Confirm fuel prices</h2>
    ${screen("Fuel Price Setup", `
      <div class="four">
        ${field("Price Effective Date", "2026-07-23")}
        ${field("Price Coverage", "Daily")}
        ${field("Pricing Basis", "Cashier Entered")}
        ${field("Branch", "Liloan", true)}
      </div>
      <div class="three">
        ${field("Premium Manager Price", "76.80")}
        ${field("Regular Manager Price", "75.80")}
        ${field("Diesel Manager Price", "72.30")}
      </div>
      <div class="button success">Confirm Fuel Prices</div>
    `, "Manager")}
    <div class="two">
      <div>
        ${step(1, "Confirm branch and effective date", "Prices must belong to the station and sales date the cashier is reporting.")}
        ${step(2, "Choose Daily or a specific shift", "Daily applies to all three shifts. Use Shift coverage only when that shift had a different price.")}
        ${step(3, "Enter Premium, Regular, and Diesel", "Use the official pump selling prices. Keep decimal centavos.")}
        ${step(4, "Press Confirm Fuel Prices", "Wait for the success message. Cashier receives the update automatically.")}
      </div>
      <div>
        ${callout("Do not leave sold products blank", "If liters were sold and the price is zero/missing, the cashier report cannot calculate correct fuel sales.", "bad")}
        ${callout("Do not subtract points/discounts", "Enter the official base pump price. Redemptions and points are recorded separately in the cashier report.", "info")}
        ${callout("Check before confirming", "Wrong price, date, branch, or coverage changes sales totals. Re-read all four selectors first.", "warn")}
      </div>
    </div>
  `, "green"),

  page("MANAGER", 2, 4, "Price Change During Shift", "Use only when the official pump price changes before the shift ends", `
    ${screen("Price Change During Shift", `
      <div class="three">
        ${field("Product", "Regular")}
        ${field("Effective Time", "1:30 PM")}
        ${field("New Manager Price", "76.30")}
      </div>
      <table>
        <thead><tr><th>Pump / Nozzle</th><th>Opening</th><th>Reading At Change</th><th>Current Closing</th></tr></thead>
        <tbody>
          <tr><td><b>Pump 1 - Regular</b></td><td class="readonly">325,929.76</td><td class="input">325,950.00</td><td class="readonly">326,030.05</td></tr>
          <tr><td><b>Pump 2 - Regular</b></td><td class="readonly">209,393.00</td><td class="input">209,410.00</td><td class="readonly">209,455.00</td></tr>
        </tbody>
      </table>
      <div class="button success">Confirm Price Change</div>
    `, "Only if price changed")}
    <div class="two">
      <div>
        <h2>Correct procedure</h2>
        ${step(1, "Choose the affected product", "Premium, Regular, or Diesel.")}
        ${step(2, "Enter the exact effective time", "Use the time the pump selling price officially changed.")}
        ${step(3, "Enter the new selling price", "Do not overwrite the old part of the shift.")}
        ${step(4, "Get every matching nozzle reading", "Enter the physical register reading at the change time for all nozzles selling that product.")}
        ${step(5, "Confirm once", "The system divides sales before and after the change reading.")}
      </div>
      <div>
        <h2>Do not do these</h2>
        ${callout("Do not use final closing", "The change reading is the reading at the exact price-change time, not the shift-end reading.", "bad")}
        ${callout("Do not skip a nozzle", "Every nozzle selling the affected product needs a change reading.", "bad")}
        ${callout("Do not use this for tomorrow", "A price effective before the next shift begins belongs in normal Fuel Price Setup.", "warn")}
        <div class="example"><b>Example</b><span>Regular changed from ₱75.80 to ₱76.30 at 1:30 PM. Sales before register 325950.00 use ₱75.80; sales after it use ₱76.30.</span></div>
      </div>
    </div>
    <div class="bottom-strip"><b>Before confirming:</b> product, effective time, new price, and every matching pump/nozzle reading are complete.</div>
  `, "green"),

  page("MANAGER", 3, 4, "Daily Bank Deposit", "Record one real bank transaction with the correct sales coverage", `
    ${screen("Daily Bank Deposit", `
      <div class="three">
        ${field("Deposit Date", "2026-07-23")}
        ${field("Sales Date Covered", "2026-07-22")}
        ${field("Covers", "Shift 2 + Shift 3")}
        ${field("Bank", "BDO")}
        ${field("Reference / Minutes & Seconds", "14:36")}
        ${field("Amount", "100,000.00")}
      </div>
      <div class="button success">Save Daily Bank Deposit</div>
    `, "Manager")}
    <div class="two">
      <div>
        <h2>Meaning of each field</h2>
        <table class="compact">
          <tbody>
            <tr><td><b>Deposit Date</b></td><td>The day the bank accepted the money.</td></tr>
            <tr><td><b>Sales Date Covered</b></td><td>The sales day that produced the cash.</td></tr>
            <tr><td><b>Covers</b></td><td>Shift 1, Shift 2, Shift 3, a combination, or All Shifts.</td></tr>
            <tr><td><b>Bank</b></td><td>The receiving bank.</td></tr>
            <tr><td><b>Reference</b></td><td>Bank reference; Liloan may use Minutes and Seconds.</td></tr>
            <tr><td><b>Amount</b></td><td>The exact amount of this one bank transaction.</td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <h2>Coverage rules</h2>
        ${callout("One deposit covers many shifts", "Enter it once and select the combined coverage. Never repeat the full amount under every shift.", "good")}
        ${callout("One deposit covers two sales dates", "Split it into separate entries by sales date and correct covered shifts. The split totals must equal the real bank transaction.", "warn")}
        ${callout("Not deposited yet", "Do not create a fake deposit. The amount remains pending cash on hand until the real deposit is entered.", "info")}
        ${callout("Admin verification", "Saving creates a Pending deposit. Only admin verifies it against bank records.", "info")}
      </div>
    </div>
    <h2>Common example</h2>
    <div class="flow three-flow">
      <div>${icon("1")}<b>Yesterday Shift 2 + 3</b><span>Select yesterday as Sales Date</span></div>
      <div>${icon("2")}<b>Deposited today</b><span>Select today as Deposit Date</span></div>
      <div>${icon("3")}<b>One combined amount</b><span>Save once with Shift 2 + Shift 3</span></div>
    </div>
  `, "green"),

  page("MANAGER", 4, 4, "Deposit History, Requests, And Quick Sticker", "Check the last seven days and send corrections through admin", `
    <h2>Manager deposit history</h2>
    ${screen("Deposit History", `
      <div class="two">${field("Deposit From", "2026-07-17")}${field("Deposit To", "2026-07-23")}</div>
      <table class="compact">
        <thead><tr><th>Sales Date</th><th>Covered Shifts</th><th>Deposit Date</th><th>Bank</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Jul 22</td><td>Shift 2 + 3</td><td>Jul 23</td><td>BDO</td><td>₱100,000</td><td>${badge("Pending", "yellow")}</td></tr>
          <tr><td>Jul 21</td><td>All Shifts</td><td>Jul 22</td><td>BPI</td><td>₱158,000</td><td>${badge("Verified", "green")}</td></tr>
        </tbody>
      </table>
    `, "Own station only")}
    <div class="two">
      <div>
        <h2>Wrong saved deposit?</h2>
        ${callout("Request Change", "Use when the deposit is real but amount, bank, reference, sales date, deposit date, or covered shifts are wrong.", "info")}
        ${callout("Request Removal", "Use when the row should not exist: duplicate, wrong station, or completely invalid transaction.", "warn")}
        ${callout("Wait for admin", "The original record remains unchanged until admin approves. Do not add a second row to hide the mistake.", "bad")}
        <h2>Status meanings</h2>
        <table class="compact">
          <tbody>
            <tr><td>${badge("Pending", "yellow")}</td><td>Saved, waiting for admin bank verification.</td></tr>
            <tr><td>${badge("Verified", "green")}</td><td>Admin matched it with bank records.</td></tr>
            <tr><td>${badge("Change Requested")}</td><td>Correction is waiting for admin approval.</td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <h2>Print-and-cut manager sticker</h2>
        <div class="sticker manager">
          <h3>MANAGER - DAILY CHECK</h3>
          <ol>
            <li>Log in to the correct branch.</li>
            <li>Set fuel prices for correct effective date.</li>
            <li>Choose Daily or exact Shift coverage.</li>
            <li>Enter Premium, Regular, Diesel base prices.</li>
            <li>Press Confirm Fuel Prices.</li>
            <li>Use Mid-Shift Change only when price changed during the shift.</li>
            <li>Save each real bank deposit once with correct dates and coverage.</li>
            <li>Check Deposit History; request Change/Removal for mistakes.</li>
            <li>Press Log Out before leaving the device.</li>
          </ol>
        </div>
        ${callout("Cashier cannot submit after price update?", "Confirm the correct station/date/shift coverage first. Cashier receives manager prices automatically; do not edit cashier report values.", "warn")}
      </div>
    </div>
  `, "green"),
];

const css = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #dfe7ee; font-family: Arial, Helvetica, sans-serif; color: #17212b; }
  body { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px; }
  .page { --accent:#1267d6; --soft:#eaf3ff; width:1240px; height:1754px; background:#fff; padding:54px 58px 42px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 12px 36px #12203330; page-break-after:always; }
  .page.green { --accent:#087f5b; --soft:#e9f8f2; }
  header { display:flex; align-items:flex-start; justify-content:space-between; border-bottom:5px solid var(--accent); padding-bottom:24px; margin-bottom:28px; }
  .brand { display:inline-block; background:#17212b; color:#fff; font-size:16px; font-weight:800; letter-spacing:1.5px; padding:9px 14px; border-radius:5px; }
  h1 { font-size:45px; line-height:1.05; margin:16px 0 8px; letter-spacing:0; }
  header p { margin:0; font-size:20px; color:#526171; }
  .page-no { color:var(--accent); font-size:16px; font-weight:800; text-align:right; letter-spacing:1px; }
  .page-no b { display:block; font-size:35px; margin-top:4px; letter-spacing:0; }
  main { flex:1; }
  h2 { font-size:27px; line-height:1.15; margin:24px 0 14px; color:#111b25; }
  h3 { font-size:20px; margin:0 0 5px; }
  p { font-size:17px; line-height:1.42; margin:0; }
  footer { border-top:2px solid #dce4eb; padding-top:14px; display:flex; justify-content:space-between; font-size:14px; color:#647384; }
  .hero-grid, .two { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
  .three { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; }
  .four { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; }
  .equal > div { min-width:0; }
  .shift-grid { display:grid; gap:12px; }
  .shift-card { border:2px solid #ccd8e3; padding:18px; border-radius:8px; display:grid; gap:5px; }
  .shift-card.active { border:4px solid var(--accent); background:var(--soft); }
  .shift-card small { color:var(--accent); font-weight:800; }
  .shift-card b { font-size:20px; }
  .shift-card span { color:#5f6d7a; font-size:15px; }
  .screen { border:2px solid #b8c5d1; border-radius:8px; overflow:hidden; background:#fbfcfe; margin-bottom:14px; }
  .screen-head { background:#17212b; color:#fff; padding:13px 16px; display:flex; align-items:center; justify-content:space-between; font-size:18px; }
  .screen > .field, .screen > .two, .screen > .three, .screen > .four, .screen > table, .screen > .mini-cards, .screen > .review, .screen > .screen-copy { margin:13px 15px; }
  .field { min-height:64px; border:2px solid #d6e0e8; border-radius:7px; background:#fff; padding:10px 13px; display:flex; flex-direction:column; justify-content:center; }
  .field span { font-size:13px; text-transform:uppercase; color:#627282; font-weight:800; margin-bottom:5px; }
  .field b { font-size:18px; }
  .field.ghost, .readonly { background:#edf1f4 !important; color:#50606f; }
  .button { margin:13px 15px; background:var(--accent); color:#fff; font-size:17px; font-weight:800; padding:13px 20px; border-radius:6px; text-align:center; }
  .button.success { background:#078548; }
  .button.warning { background:#e4a11b; color:#221a05; }
  .button.secondary { background:#e7edf3; color:#17212b; border:1px solid #becbd6; }
  .button.small { padding:10px 12px; margin:10px 12px; }
  .badge { display:inline-block; border-radius:999px; background:#dbe9f8; color:#124a84; padding:5px 10px; font-size:13px; font-weight:800; }
  .badge.green { background:#d6f5e5; color:#07643e; }
  .badge.yellow { background:#fff0bd; color:#765500; }
  .instruction { display:grid; grid-template-columns:38px 1fr; gap:11px; margin:0 0 14px; }
  .step, .icon { width:34px; height:34px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:var(--accent); color:#fff; font-weight:900; flex:none; }
  .instruction p { font-size:16px; }
  .callout { border-left:7px solid #1b70d0; background:#eef6ff; border-radius:5px; padding:14px 16px; margin:12px 0; display:grid; gap:4px; }
  .callout b { font-size:18px; }
  .callout span { font-size:16px; line-height:1.4; }
  .callout.good { border-color:#13935f; background:#e9f8f0; }
  .callout.warn { border-color:#d59817; background:#fff6d9; }
  .callout.bad { border-color:#d74444; background:#fff0f0; }
  table { width:100%; border-collapse:collapse; font-size:16px; background:#fff; }
  th { background:#e9eff5; text-align:left; font-size:14px; text-transform:uppercase; color:#465767; }
  th, td { border:1px solid #ccd7e1; padding:11px 10px; vertical-align:top; }
  td.input, .input { background:#fff; outline:3px solid #90bef4; outline-offset:-4px; font-weight:800; }
  .ghost-cell { color:#adb8c2; }
  .wizard-nav { display:flex; justify-content:flex-end; gap:8px; }
  .wizard-nav .button { min-width:180px; }
  .example { border:2px dashed var(--accent); border-radius:8px; padding:18px; display:grid; gap:8px; margin-top:14px; }
  .example b { font-size:20px; color:var(--accent); }
  .example span { font-size:17px; line-height:1.4; }
  .bottom-strip { margin-top:18px; padding:16px 20px; border-radius:7px; background:#17212b; color:#fff; font-size:17px; line-height:1.4; }
  .tile { border:2px solid #d2dce5; border-radius:7px; padding:15px; background:#fff; }
  .tile b { display:block; color:var(--accent); font-size:19px; margin-bottom:6px; }
  .tile span { font-size:15px; line-height:1.4; }
  .review { padding:12px 14px; border:1px solid #d4dee6; border-radius:6px; display:flex; justify-content:space-between; font-size:16px; }
  .review.warn { background:#fff5cc; border-color:#e3b644; }
  .flow { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; }
  .flow > div { border:2px solid #d3dee7; border-radius:8px; padding:15px; display:grid; gap:8px; }
  .flow b { font-size:17px; }
  .flow span { font-size:14px; color:#5c6c79; }
  .three-flow { grid-template-columns:repeat(3, 1fr); }
  .mini-cards { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  .mini-cards > div, .mini-grid > div { border:1px solid #cdd8e2; border-radius:6px; padding:12px; display:grid; gap:6px; }
  .mini-cards small { color:var(--accent); font-weight:800; }
  .mini-cards b { font-size:17px; }
  .mini-cards span { font-size:13px; color:#607080; }
  .mini-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .mini-grid > div { grid-template-columns:40px 1fr; align-items:center; }
  .mini-grid b, .mini-grid span { grid-column:2; }
  .compact { font-size:15px; }
  .compact th, .compact td { padding:9px; }
  .sticker { border:5px dashed #17212b; border-radius:10px; padding:20px; background:#f8fbfd; }
  .sticker h3 { text-align:center; font-size:25px; color:var(--accent); margin-bottom:12px; }
  .sticker ol { margin:0 0 14px 24px; padding:0; }
  .sticker li { font-size:16px; line-height:1.45; margin-bottom:6px; }
  .sticker > b { display:block; border-top:2px solid #b7c4cf; padding-top:12px; line-height:1.5; font-size:15px; }
  .sticker.manager li { font-size:15px; }
  @media print {
    body { display:block; padding:0; background:#fff; }
    .page { box-shadow:none; margin:0; }
  }
`;

const documentHtml = (pages) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${pages.join("")}</body></html>`;

async function buildSet(browser, name, pages) {
  const htmlPath = path.join(guideDir, `${name}-guide.html`);
  fs.writeFileSync(htmlPath, documentHtml(pages), "utf8");

  const pageHandle = await browser.newPage({ viewport: { width: 1320, height: 1830 }, deviceScaleFactor: 1.5 });
  await pageHandle.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
  const locators = pageHandle.locator(".page");
  const count = await locators.count();
  const pngs = [];
  for (let i = 0; i < count; i += 1) {
    const output = path.join(guideDir, `${name}-${String(i + 1).padStart(2, "0")}.png`);
    await locators.nth(i).screenshot({ path: output });
    pngs.push(output);
  }
  await pageHandle.pdf({
    path: path.join(pdfDir, `FuelTech-${name[0].toUpperCase()}${name.slice(1)}-Printable-Guide.pdf`),
    width: "1240px",
    height: "1754px",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  await pageHandle.close();

  const thumbs = await Promise.all(pngs.map(async (file) => sharp(file).resize({ width: 420 }).png().toBuffer()));
  const meta = await sharp(thumbs[0]).metadata();
  const columns = 2;
  const rows = Math.ceil(thumbs.length / columns);
  const gap = 24;
  const width = columns * 420 + (columns + 1) * gap;
  const height = rows * meta.height + (rows + 1) * gap;
  await sharp({
    create: { width, height, channels: 4, background: "#dfe7ee" },
  }).composite(thumbs.map((input, index) => ({
    input,
    left: gap + (index % columns) * (420 + gap),
    top: gap + Math.floor(index / columns) * (meta.height + gap),
  }))).png().toFile(path.join(guideDir, `${name}-contact-sheet.png`));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await buildSet(browser, "cashier", cashierPages);
    await buildSet(browser, "manager", managerPages);
  } finally {
    await browser.close();
  }
  console.log(`Printable staff guides created in ${guideDir}`);
})();
