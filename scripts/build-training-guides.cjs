const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "..", "guides");
fs.mkdirSync(outDir, { recursive: true });

const css = `
  :root {
    --ink:#16202c; --muted:#5c6a7a; --line:#d8e0ea; --soft:#f6f8fb;
    --blue:#1769e0; --blue2:#eaf2ff; --green:#0c8a4a; --green2:#e9f8f0;
    --yellow:#8a5a00; --yellow2:#fff5d6; --red:#b42318; --red2:#ffedeb;
    --dark:#111827;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:#edf1f6; color:var(--ink); font-family:Arial,Helvetica,sans-serif; line-height:1.4; }
  .book { width:min(1060px, calc(100% - 32px)); margin:22px auto; background:white; border:1px solid var(--line); box-shadow:0 16px 42px rgba(20,33,51,.12); }
  .cover { padding:34px; background:linear-gradient(135deg,rgba(23,105,224,.11),transparent 42%),linear-gradient(315deg,rgba(12,138,74,.09),transparent 36%),white; border-bottom:1px solid var(--line); }
  .content { padding:28px 34px 34px; }
  .eyebrow { display:inline-flex; width:fit-content; padding:7px 11px; border-radius:999px; background:var(--dark); color:white; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
  h1,h2,h3,h4 { margin:0; line-height:1.12; }
  h1 { font-size:42px; margin-top:16px; max-width:820px; }
  h2 { font-size:25px; margin:26px 0 12px; padding-top:4px; }
  h3 { font-size:18px; margin:0 0 7px; }
  h4 { font-size:15px; margin:10px 0 4px; }
  p { margin:0 0 8px; }
  ul,ol { margin:7px 0 0 20px; padding:0; }
  li { margin:3px 0; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; margin:8px 0 12px; break-inside:avoid; }
  th { background:#eff4fa; color:#344054; text-align:left; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; }
  th,td { border:1px solid var(--line); padding:7px; vertical-align:top; }
  tr:nth-child(even) td { background:#fbfdff; }
  .lead { color:var(--muted); font-size:17px; max-width:840px; margin-top:10px; }
  .grid { display:grid; gap:10px; }
  .two { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .three { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .four { grid-template-columns:repeat(4,minmax(0,1fr)); }
  .card, .callout, .screen, .step, .sticker { break-inside:avoid; }
  .card { border:1px solid var(--line); background:var(--soft); border-radius:10px; padding:11px; }
  .card strong { display:block; font-size:17px; margin-top:2px; }
  .label { display:block; color:var(--muted); font-size:10.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; }
  .note { color:var(--muted); font-size:12px; }
  .callout { border-left:5px solid var(--blue); background:var(--blue2); padding:11px 13px; border-radius:9px; margin:12px 0; }
  .good { border-color:#9bd8b8; background:var(--green2); }
  .warn { border-color:#f0cf74; background:var(--yellow2); }
  .bad { border-color:#f4aaa5; background:var(--red2); }
  .screen { border:2px solid #151b23; border-radius:14px; background:#fbfcfe; padding:12px; margin:8px 0 12px; box-shadow:inset 0 0 0 1px #edf1f6; }
  .screen-top { display:flex; justify-content:space-between; gap:8px; padding-bottom:8px; border-bottom:1px solid var(--line); margin-bottom:8px; font-weight:900; }
  .pill { display:inline-flex; padding:4px 8px; border-radius:999px; background:#edf2f7; color:#344054; font-size:10.5px; font-weight:800; white-space:nowrap; }
  .fake-field { min-height:40px; border:1px solid #cfd8e3; border-radius:8px; background:white; padding:7px 9px; }
  .fake-field b { display:block; font-size:13px; }
  .input { border:2px solid #8db0e8; background:white; border-radius:7px; padding:7px; font-weight:800; }
  .read { background:#edf1f5; color:#4b5563; border:1px solid #cdd5df; border-radius:7px; padding:7px; font-weight:800; }
  .button { display:inline-flex; align-items:center; justify-content:center; min-height:34px; border-radius:8px; padding:7px 11px; font-weight:900; background:var(--blue); color:white; margin-top:6px; }
  .button.green { background:var(--green); } .button.gray { background:#64748b; }
  .steps { counter-reset:step; display:grid; gap:9px; }
  .step { display:grid; grid-template-columns:34px 1fr; gap:10px; border:1px solid var(--line); border-radius:12px; padding:11px; background:white; }
  .step:before { counter-increment:step; content:counter(step); width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:var(--blue); color:white; font-weight:900; }
  .do-dont { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .workflow { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; margin:10px 0 12px; }
  .flow { border:1px solid var(--line); border-radius:10px; padding:9px; background:white; min-height:74px; }
  .flow b { display:block; color:var(--blue); font-size:13px; margin-bottom:3px; }
  .flow span { color:var(--muted); font-size:11.5px; }
  .legend { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:10px 0 12px; }
  .legend-item { border:1px solid var(--line); border-radius:10px; padding:9px; background:white; }
  .legend-item b { display:block; font-size:13px; }
  .mini { font-size:11.5px; color:var(--muted); }
  .checklist { columns:2; column-gap:24px; }
  .checklist li { break-inside:avoid; }
  .formula { font-family:Consolas,Monaco,monospace; font-weight:900; background:#f1f5f9; padding:2px 5px; border-radius:5px; }
  .sticker-sheet { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
  .sticker { border:2px dashed #95a3b4; border-radius:12px; padding:9px; min-height:106px; }
  .footer { color:var(--muted); font-size:11px; display:flex; justify-content:space-between; gap:12px; border-top:1px solid var(--line); padding-top:10px; margin-top:18px; }
  .break-before { break-before:page; }
  .keep { break-inside:avoid; }
  @page { size:A4; margin:9mm; }
  @media print {
    body { background:white; }
    .book { width:100%; margin:0; border:none; box-shadow:none; }
    .cover { padding:7mm 7mm 5mm; }
    .content { padding:5mm 7mm 7mm; }
    h2 { margin-top:16px; }
    .workflow { grid-template-columns:repeat(5,minmax(0,1fr)); }
    .footer { display:none; }
    a { color:inherit; text-decoration:none; }
  }
`;

function doc(title, role, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${css}</style>
</head>
<body>
  <main class="book">
    <section class="cover">
      <span class="eyebrow">FuelTech Accounting</span>
      <h1>${title}</h1>
      <p class="lead">Detailed ${role} guidebook with examples, screen-style pictures, what to input, what to avoid, and final checks before saving or submitting.</p>
      <div class="grid four" style="margin-top:18px">
        <div class="card"><span class="label">Shift 1</span><strong>4:00 AM - 1:00 PM</strong></div>
        <div class="card"><span class="label">Shift 2</span><strong>1:00 PM - 10:00 PM</strong></div>
        <div class="card"><span class="label">Shift 3</span><strong>10:00 PM - 4:00 AM</strong></div>
        <div class="card"><span class="label">Website</span><strong>fueltechphil.vercel.app</strong></div>
      </div>
      <div class="callout warn"><b>Training rule:</b> Do not guess. If branch, date, shift, pump number, product, price, or deposit coverage looks wrong, stop and ask before pressing confirm.</div>
    </section>
    <section class="content">
      ${body}
      <div class="footer"><span>FuelTech Accounting</span><span>${role} guidebook</span></div>
    </section>
  </main>
</body>
</html>`;
}

const cashierBody = `
  <h2>1. Cashier Job Summary</h2>
  <div class="grid three">
    <div class="card"><span class="label">Your job</span><strong>Record the shift</strong><p class="note">Pump readings, tank readings, deductions, PO/PR, oil, Coke, then submit.</p></div>
    <div class="card"><span class="label">Your link</span><strong>/cashier</strong><p class="note">Use cashier login only. Do not use manager/admin login.</p></div>
    <div class="card"><span class="label">Final action</span><strong>Confirm Report</strong><p class="note">Submit only when every number is checked.</p></div>
  </div>
  <div class="workflow">
    <div class="flow"><b>1. Login</b><span>Pick branch and enter cashier PIN.</span></div>
    <div class="flow"><b>2. Check</b><span>Branch, date, shift, cashier name.</span></div>
    <div class="flow"><b>3. Input</b><span>Pumps, tank, deductions, oil, Coke.</span></div>
    <div class="flow"><b>4. Review</b><span>Fix warnings before confirming.</span></div>
    <div class="flow"><b>5. Submit</b><span>Confirm report and wait for saved online.</span></div>
  </div>
  <div class="legend">
    <div class="legend-item"><b>Gray box</b><span class="mini">Read-only. Do not type here.</span></div>
    <div class="legend-item"><b>White/blue input</b><span class="mini">Type the number from your record.</span></div>
    <div class="legend-item"><b>Green button</b><span class="mini">Save or confirm after checking.</span></div>
    <div class="legend-item"><b>Yellow/red warning</b><span class="mini">Stop and fix before submitting.</span></div>
  </div>
  <div class="callout"><b>Cashier boundary:</b> Cashier records the shift. Cashier does not change fuel prices, approve deposits, verify banks, or use manager/admin access.</div>

  <h2>2. Login And First Screen Check</h2>
  <div class="steps">
    <div class="step"><div><h3>Open cashier page</h3><p>Open <b>https://fueltechphil.vercel.app/cashier</b>, choose the correct branch, enter cashier PIN, then press <b>Proceed</b>.</p>
      <div class="screen"><div class="screen-top">Cashier Branch Access <span class="pill">Login</span></div><div class="grid two"><div class="fake-field"><span class="label">Selected Branch</span><b>Liloan</b></div><div class="fake-field"><span class="label">Cashier PIN</span><b>******</b></div></div><span class="button">Proceed</span></div></div></div>
    <div class="step"><div><h3>Check branch, date, shift, and status</h3><p>Do this before typing anything. If the report date or shift is wrong, do not continue.</p>
      <div class="screen"><div class="screen-top">Report Information <span class="pill">Check first</span></div><div class="grid four"><div class="fake-field"><span class="label">Branch</span><b>Liloan</b></div><div class="fake-field"><span class="label">Report Date</span><b>2026-07-09</b></div><div class="fake-field"><span class="label">Active Shift</span><b>Shift 1 - 4 AM to 1 PM</b></div><div class="fake-field"><span class="label">Report Status</span><b>Draft</b></div></div></div></div></div>
    <div class="step"><div><h3>Enter cashier name</h3><p>Use the real cashier/teller name. This is used for checking who submitted the shift.</p></div></div>
  </div>
  <div class="callout warn"><b>If the page opens on the wrong branch or wrong shift:</b> stop first. Do not type pump readings into the wrong report. Ask manager/admin before continuing.</div>

  <h2>3. If First Opening Setup Appears</h2>
  <p>First Opening Setup appears only when the system has no previous confirmed readings. This is the starting point of the station. Enter opening numbers carefully because future shifts depend on them.</p>
  <div class="screen">
    <div class="screen-top">First Opening Setup <span class="pill">Only when starting from zero</span></div>
    <table><tr><th>Pump</th><th>Nozzle</th><th>First Opening Pump Reading</th><th>Where to get it</th></tr>
      <tr><td>Pump 1</td><td>Premium</td><td><div class="input">408967.16</div></td><td>Copy exact register number from pump</td></tr>
      <tr><td>Pump 1</td><td>Regular</td><td><div class="input">325929.76</div></td><td>Copy exact register number from pump</td></tr>
      <tr><td>Pump 1</td><td>Diesel</td><td><div class="input">212631.95</div></td><td>Copy exact register number from pump</td></tr>
    </table>
    <div class="grid three"><div class="fake-field"><span class="label">Underground Tank Opening</span><b>Tank inventory in liters</b></div><div class="fake-field"><span class="label">Coke Beginning</span><b>Starting Coke count</b></div><div><span class="button green">Confirm First Opening</span></div></div>
  </div>
  <div class="do-dont">
    <div class="card good"><h3>Do</h3><ul><li>Copy the exact opening pump register.</li><li>Use decimals when shown, like <b>408967.16</b>.</li><li>Confirm only when all pumps/tanks are correct.</li></ul></div>
    <div class="card bad"><h3>Do Not</h3><ul><li>Do not guess opening numbers.</li><li>Do not switch Premium, Regular, Diesel.</li><li>Do not put tank dip numbers into pump readings.</li></ul></div>
  </div>

  <h2>4. Official Pump Reading Register</h2>
  <p>This is the main sales source. The system computes liters sold from pump register readings.</p>
  <div class="screen">
    <div class="screen-top">Official Pump Reading Register <span class="pill">Most important cashier section</span></div>
    <table><tr><th>Pump</th><th>Nozzle</th><th>Previous Shift Closing</th><th>Current Closing</th><th>Liters Sold</th></tr>
      <tr><td>Pump 1</td><td>Premium</td><td><div class="read">408967.16</div></td><td><div class="input">409019.92</div></td><td><b>52.76 L</b></td></tr>
      <tr><td>Pump 1</td><td>Regular</td><td><div class="read">325929.76</div></td><td><div class="input">326030.05</div></td><td><b>100.29 L</b></td></tr>
      <tr><td>Pump 1</td><td>Diesel</td><td><div class="read">212631.95</div></td><td><div class="input">212631.95</div></td><td><b>0 L</b></td></tr>
    </table>
  </div>
  <div class="grid two">
    <div class="card"><span class="label">Before number</span><strong>Previous Shift Closing</strong><p class="note">Gray/read-only. This is the last confirmed ending register from the previous shift.</p></div>
    <div class="card"><span class="label">After number</span><strong>Current Closing</strong><p class="note">Type the ending register reading for this shift. This is the number from the pump now.</p></div>
  </div>
  <div class="callout"><b>Cashier does not need to calculate liters.</b> Just copy the gray Previous Shift Closing, type the correct Current Closing from the pump register, and let the system calculate Liters Sold automatically.</div>
  <div class="callout warn"><b>No gasoline / closed station:</b> If there were no sales, type the same number in Current Closing as Previous Shift Closing. Example: before 1000, after 1000 = 0 L. This is allowed.</div>
  <div class="callout bad"><b>Never type lower than previous closing.</b> Example: before 1000, after 990 is wrong because it creates negative liters.</div>

  <h2>5. Product And Pump Rules</h2>
  <table><tr><th>Check</th><th>Correct</th><th>Wrong</th></tr>
    <tr><td>Product</td><td>Premium reading goes to Premium row</td><td>Putting Premium reading in Regular row</td></tr>
    <tr><td>Pump number</td><td>Pump 1 reading goes to Pump 1 row</td><td>Typing Pump 2 reading in Pump 1 row</td></tr>
    <tr><td>Decimals</td><td>Type 409019.92 if pump shows decimals</td><td>Typing 409019 or 40901992 by mistake</td></tr>
    <tr><td>Zero sales</td><td>Same previous/current number</td><td>Leaving it blank when no sales</td></tr>
  </table>
  <div class="callout"><b>Decimal rule:</b> Type decimals exactly as shown on the pump. If the pump shows <b>409019.92</b>, type <b>409019.92</b>. Do not remove the decimal point.</div>

  <h2>6. If Fuel Price Changes During Shift</h2>
  <p>The manager handles the price-change entry in the manager page. The cashier's job is to help record the pump register reading at the exact time the price changed.</p>
  <table><tr><th>Situation</th><th>Cashier should do</th><th>Cashier should not do</th></tr>
    <tr><td>Fuel price changes during the shift</td><td>Write down the exact time and pump register reading for each affected product/nozzle</td><td>Do not change the manager price in the app</td></tr>
    <tr><td>Manager asks for price-change reading</td><td>Give the pump reading at the price-change time, not the final closing reading</td><td>Do not guess the reading later</td></tr>
    <tr><td>No price change during shift</td><td>Do nothing in this area; continue normal current closing entry</td><td>Do not invent a price-change entry</td></tr>
  </table>
  <div class="callout warn"><b>Example:</b> If Regular price changed at 1:30 PM, cashier should record the Regular pump register reading at 1:30 PM. The manager uses that reading to split sales before and after the new price.</div>

  <h2>7. Underground Tank</h2>
  <p>The underground tank is a reference check. Official fuel sales come from pump readings. The tank section helps detect inventory differences.</p>
  <div class="screen">
    <div class="screen-top">Underground Tank <span class="pill">Inventory reference</span></div>
    <table><tr><th>Field</th><th>What to input</th><th>Example</th><th>Notes</th></tr>
      <tr><td>Previous Shift Dip</td><td>Read-only</td><td>3500 L</td><td>Comes from last shift</td></tr>
      <tr><td>Delivery</td><td>Liters delivered into tank</td><td>2000</td><td>Only if delivery happened</td></tr>
      <tr><td>Pull-Out</td><td>Liters removed from tank</td><td>0</td><td>Only if pull-out happened</td></tr>
      <tr><td>Calibration</td><td>Liters used for calibration and returned</td><td>10</td><td>Reduces official sales but not tank inventory</td></tr>
      <tr><td>Current Actual Dip</td><td>Actual dip at shift end</td><td>6190</td><td>Copy from dip measurement</td></tr>
    </table>
  </div>

  <h2>8. Deductions, FuelTech Pay, PO/PR</h2>
  <div class="grid two">
    <div class="card"><h3>FuelTech Pay Total</h3><p>Enter the total non-cash payment amount together: card, GCash, Paymaya, and similar payments.</p></div>
    <div class="card"><h3>Points Withdrawn</h3><p>This is based on Cash Redemption + Fuel Redemption. Do not manually invent this number if shown as read-only.</p></div>
  </div>
  <table><tr><th>Section</th><th>What cashier enters</th><th>What not to do</th></tr>
    <tr><td>Deductions</td><td>FuelTech Pay Total and valid deduction amounts</td><td>Do not put bank deposit here</td></tr>
    <tr><td>PO Accounts</td><td>Account/customer name and amount</td><td>Do not duplicate the same PO</td></tr>
    <tr><td>Purchase Requests</td><td>Particular/item and amount</td><td>Do not enter unapproved expenses</td></tr>
    <tr><td>Oil Sales</td><td>Total oil sales amount</td><td>Do not mix oil with fuel sales</td></tr>
    <tr><td>Coke Ending</td><td>Ending Coke count</td><td>Do not edit Coke Beginning</td></tr>
  </table>
  <div class="grid two">
    <div class="card good"><h3>Cash redemption / fuel redemption</h3><p>Enter redemption only in the correct redemption fields if they appear in the app. Points Withdrawn is based on these redemptions.</p></div>
    <div class="card warn"><h3>Bank deposit is not cashier input</h3><p>Do not put bank deposit amount in deductions, PO, PR, or FuelTech Pay. Manager handles bank deposits.</p></div>
  </div>
  <div class="screen">
    <div class="screen-top">End-of-Shift Cash Count <span class="pill">Physical counted cash</span></div>
    <div class="grid four">
      <div class="fake-field"><span class="label">End-of-Shift Cash Count</span><b>Cashier types physical cash counted</b></div>
      <div class="fake-field"><span class="label">Expected Cash On Hand</span><b>System calculated</b></div>
      <div class="fake-field"><span class="label">Actual Cash Counted</span><b>Cashier count</b></div>
      <div class="fake-field"><span class="label">Actual Cash Difference</span><b>Actual minus expected</b></div>
    </div>
    <div class="callout warn"><b>Important:</b> End-of-Shift Cash Count does not replace expected cash and does not replace bank deposit. It only checks physical counted cash against the system expected cash on hand.</div>
  </div>

  <h2>9. Request Date Correction</h2>
  <p>Use this if the cashier needs to correct a past date or shift. It opens only after admin approval.</p>
  <div class="steps"><div class="step"><div><h3>Select correct report date and shift</h3><p>Choose the old date/shift that needs correction.</p></div></div><div class="step"><div><h3>Type reason</h3><p>Example: "Wrong Regular reading typed in Shift 2."</p></div></div><div class="step"><div><h3>Press Send Request to Admin</h3><p>Wait for admin approval before editing that report.</p></div></div></div>
  <div class="callout bad"><b>Do not use correction request to skip today's report.</b> It is only for fixing a real wrong date/shift after admin approval.</div>

  <h2>10. Submit Report And Missing Report Warning</h2>
  <div class="screen">
    <div class="screen-top">Confirm Report Popup <span class="pill">Final check</span></div>
    <ul><li>Check branch and shift.</li><li>Check total liters.</li><li>If unsure, press <b>Go Back</b>.</li><li>If correct, press <b>Confirm Report</b>.</li></ul>
    <span class="button gray">Go Back</span> <span class="button green">Confirm Report</span>
  </div>
  <div class="callout bad"><b>Submitted means sent to admin.</b> Do not confirm if the report is not complete.</div>
  <div class="callout warn"><b>After confirming:</b> Keep the page open until the app says it is saved online. Do not close the browser immediately after pressing Confirm Report.</div>
  <div class="screen">
    <div class="screen-top">Missing Previous Shift Warning <span class="pill">What cashier may see</span></div>
    <div class="callout warn" style="margin-top:0"><b>Previous shift is missing.</b><br>Please complete <b>2026-06-29 - Shift 3</b> first so pump readings stay correct.</div>
    <div class="grid two">
      <div class="fake-field"><span class="label">Missing report</span><b>June 29, 2026 - Shift 3</b><p class="note">This is the exact report that must be completed first.</p></div>
      <div class="fake-field"><span class="label">Current report waiting</span><b>June 30, 2026 - Shift 1</b><p class="note">Do not continue this one until the missing shift is submitted.</p></div>
    </div>
    <span class="button">Go to Missing Shift</span>
  </div>
  <div class="screen">
    <div class="screen-top">After Pressing Go to Missing Shift <span class="pill">What to input</span></div>
    <div class="grid four">
      <div class="fake-field"><span class="label">Branch</span><b>Liloan</b></div>
      <div class="fake-field"><span class="label">Report Date</span><b>2026-06-29</b></div>
      <div class="fake-field"><span class="label">Active Shift</span><b>Shift 3</b></div>
      <div class="fake-field"><span class="label">Status</span><b>Draft</b></div>
    </div>
    <table><tr><th>What cashier sees</th><th>What cashier inputs</th><th>Reminder</th></tr>
      <tr><td><div class="read">Previous Shift Closing</div></td><td><div class="input">Current Closing from missing shift paper/register</div></td><td>Do not type today's reading here.</td></tr>
      <tr><td><div class="read">Correct missing date and shift</div></td><td>Cashier name, pump readings, underground tank, deductions, oil, Coke</td><td>Use the records for that missing shift only.</td></tr>
      <tr><td>Confirm Report popup</td><td>Press Confirm Report only after checking everything</td><td>Then continue the next shift/report.</td></tr>
    </table>
  </div>
  <div class="callout bad"><b>Important:</b> The Go to Missing Shift button is not for changing any random report. It opens the specific missing shift needed so the next pump beginning numbers stay correct.</div>

  <h2>11. Troubleshooting</h2>
  <table><tr><th>Warning/problem</th><th>Meaning</th><th>Cashier action</th></tr>
    <tr><td>Previous shift is missing</td><td>The shift before this was not submitted</td><td>Press Go to Missing Shift and complete it first</td></tr>
    <tr><td>Opening is missing</td><td>No previous reading to compare</td><td>Complete first opening or missing previous report</td></tr>
    <tr><td>Closing lower than opening</td><td>Negative liters</td><td>Check typed number, pump, and product</td></tr>
    <tr><td>Pump price missing</td><td>There are sold liters but no price</td><td>Tell manager to enter fuel price</td></tr>
    <tr><td>Not saved online yet</td><td>Data is still syncing</td><td>Keep page open until saved online</td></tr>
    <tr><td>Submitted button already green</td><td>This report may already be submitted</td><td>Do not submit again unless admin instructed you</td></tr>
    <tr><td>Number looks too high</td><td>Pump, product, or decimal may be wrong</td><td>Compare with paper/register before confirming</td></tr>
  </table>

  <h2>12. Final Cashier Checklist</h2>
  <ul class="checklist"><li>Correct branch</li><li>Correct date</li><li>Correct shift</li><li>Cashier name filled</li><li>Pump readings copied exactly</li><li>Premium/Regular/Diesel not switched</li><li>Decimals included</li><li>Tank dip entered</li><li>Delivery entered if any</li><li>Calibration entered if any</li><li>FuelTech Pay entered</li><li>PO/PR entered if any</li><li>Oil sales entered if any</li><li>Coke ending entered</li><li>End-of-shift cash counted</li><li>Warnings fixed</li><li>Confirm popup checked</li><li>Page kept open until saved online</li></ul>

  <h2>Sticker Reminders - Cashier</h2>
  <div class="sticker-sheet"><div class="sticker"><h3>Before Typing</h3><ul><li>Check branch.</li><li>Check date.</li><li>Check shift.</li><li>Enter cashier name.</li></ul></div><div class="sticker"><h3>Pump Rule</h3><ul><li>Gray = previous closing.</li><li>White input = current closing.</li><li>Current must not be lower.</li></ul></div><div class="sticker"><h3>Cash Count</h3><ul><li>Count physical cash.</li><li>Type end-of-shift cash count.</li><li>It does not replace bank deposit.</li></ul></div><div class="sticker"><h3>Submit</h3><ul><li>Read popup.</li><li>If unsure, Go Back.</li><li>Confirm only when finished.</li></ul></div></div>
`;

const managerBody = `
  <h2>1. Manager Job Summary</h2>
  <div class="grid three">
    <div class="card"><span class="label">Your job</span><strong>Prices and deposits</strong><p class="note">Enter fuel prices, price changes, and daily bank deposits for your own station.</p></div>
    <div class="card"><span class="label">Your link</span><strong>/manager</strong><p class="note">Use manager login only. Do not use cashier login.</p></div>
    <div class="card"><span class="label">Admin approval</span><strong>Required for changes</strong><p class="note">Wrong deposits require Request Change or Request Removal.</p></div>
  </div>
  <div class="workflow">
    <div class="flow"><b>1. Login</b><span>Pick only your station branch.</span></div>
    <div class="flow"><b>2. Prices</b><span>Enter Premium, Regular, Diesel selling prices.</span></div>
    <div class="flow"><b>3. Price Changes</b><span>Use only when price changed mid-shift.</span></div>
    <div class="flow"><b>4. Deposits</b><span>Save bank deposit with correct sales date and shifts.</span></div>
    <div class="flow"><b>5. Review</b><span>Use history; request change/removal if wrong.</span></div>
  </div>
  <div class="legend">
    <div class="legend-item"><b>Gray box</b><span class="mini">Status or saved information.</span></div>
    <div class="legend-item"><b>White/blue input</b><span class="mini">Type the number or detail.</span></div>
    <div class="legend-item"><b>Green button</b><span class="mini">Save after checking.</span></div>
    <div class="legend-item"><b>Yellow/red warning</b><span class="mini">Stop and verify first.</span></div>
  </div>
  <div class="callout"><b>Manager boundary:</b> Manager handles prices and bank deposits for their station. Manager does not submit cashier reports, approve bank verification, or use cashier/admin access.</div>

  <h2>2. Login And First Check</h2>
  <div class="steps"><div class="step"><div><h3>Open manager page</h3><p>Open <b>https://fueltechphil.vercel.app/manager</b>, choose your branch, enter manager PIN, and press <b>Proceed</b>.</p></div></div><div class="step"><div><h3>Confirm branch</h3><p>Manager should only enter data for their own station. If branch is wrong, stop before saving anything.</p></div></div></div>
  <div class="callout warn"><b>If branch is wrong:</b> stop. Do not enter prices or deposits under another station. Go back and choose the correct branch first.</div>

  <h2>3. Fuel Price Setup</h2>
  <p>Fuel prices must be entered before cashier submits reports with sold liters. The cashier report uses these prices to calculate fuel sales.</p>
  <div class="screen">
    <div class="screen-top">Fuel Price Setup <span class="pill">Manager</span></div>
    <div class="grid four"><div class="fake-field"><span class="label">Branch</span><b>Liloan</b></div><div class="fake-field"><span class="label">Price Effective Date</span><b>2026-07-09</b></div><div class="fake-field"><span class="label">Pricing Coverage</span><b>Daily</b></div><div class="fake-field"><span class="label">Pricing Basis</span><b>Carries forward</b></div></div>
    <div class="grid three" style="margin-top:8px"><div class="fake-field"><span class="label">Premium Manager Price</span><b>72.50</b></div><div class="fake-field"><span class="label">Regular Manager Price</span><b>71.50</b></div><div class="fake-field"><span class="label">Diesel Manager Price</span><b>67.80</b></div></div>
    <span class="button green">Confirm Fuel Prices</span>
  </div>
  <table><tr><th>Field</th><th>What to input</th><th>When to use</th></tr>
    <tr><td>Price Effective Date</td><td>Date the price starts</td><td>Use the sales date, not the deposit date</td></tr>
    <tr><td>Pricing Coverage: Daily</td><td>Price applies to the whole day and carries forward</td><td>Normal case</td></tr>
    <tr><td>Pricing Coverage: Shift</td><td>Price applies to one shift only</td><td>Only when one shift has different pricing</td></tr>
    <tr><td>Manager Price</td><td>Selling price per liter</td><td>Premium, Regular, Diesel</td></tr>
  </table>
  <div class="grid two">
    <div class="card good"><h3>Daily pricing</h3><p>Use this for normal days. The price applies to the whole day and continues until a new price is saved.</p></div>
    <div class="card warn"><h3>Shift pricing</h3><p>Use this only when one shift has a different price. Choose the exact shift before confirming.</p></div>
  </div>
  <div class="callout bad"><b>Important:</b> Do not leave prices blank when there are fuel sales. Cashier may be blocked or sales may be wrong.</div>
  <div class="callout warn"><b>If cashier sees "pump price missing":</b> enter the correct fuel price for that sales date/shift, press <b>Confirm Fuel Prices</b>, then ask cashier to refresh and submit again.</div>

  <h2>4. Price Change During Shift</h2>
  <p>Use this only when the price changes in the middle of an active shift. This section teaches the "before and after price/register" rule.</p>
  <div class="screen">
    <div class="screen-top">Price Change During Shift <span class="pill">Only if price changed mid-shift</span></div>
    <div class="grid three"><div class="fake-field"><span class="label">Product</span><b>Regular</b></div><div class="fake-field"><span class="label">Effective Time</span><b>1:30 PM</b></div><div class="fake-field"><span class="label">New Manager Price</span><b>72.00</b></div></div>
    <table><tr><th>Pump</th><th>Opening register</th><th>Price-change register</th><th>Current closing</th><th>Meaning</th></tr>
      <tr><td>Pump 1 Regular</td><td>325929.76</td><td><div class="input">325950.00</div></td><td>326030.05</td><td>Before 325950 uses old price; after 325950 uses new price</td></tr>
      <tr><td>Pump 2 Regular</td><td>209393.00</td><td><div class="input">209410.00</div></td><td>209455.00</td><td>Must be between opening and closing</td></tr>
    </table>
  </div>
  <div class="grid two">
    <div class="card good"><h3>Correct</h3><ul><li>Old price: before effective time.</li><li>New price: after effective time.</li><li>Price-change register is the pump reading at the exact change time.</li><li>Enter every matching nozzle for that product.</li></ul></div>
    <div class="card bad"><h3>Wrong</h3><ul><li>Do not overwrite whole-day price if change happened mid-shift.</li><li>Do not leave one nozzle blank.</li><li>Do not type a price-change reading lower than opening or higher than closing.</li></ul></div>
  </div>
  <div class="callout"><b>Simple example:</b> Regular price changed from 71.50 to 72.00 at 1:30 PM. The pump register at 1:30 PM was 325950.00. Sales before 325950.00 use 71.50. Sales after 325950.00 use 72.00.</div>
  <div class="callout warn"><b>Ask cashier for the exact pump register at the price-change time.</b> Do not use the final closing reading as the price-change reading.</div>

  <h2>5. Manager Summary</h2>
  <p>This section is for quick status only. It shows report status, bank deposits, pending verification, and deposit rows for the selected station/report.</p>
  <table><tr><th>Card</th><th>Meaning</th><th>Manager action</th></tr>
    <tr><td>Report Status</td><td>Draft or Submitted</td><td>Cashier submits reports; manager should not use cashier login</td></tr>
    <tr><td>Bank Deposits</td><td>Deposits entered for selected report</td><td>Check if deposit was saved under correct coverage</td></tr>
    <tr><td>Pending Verification</td><td>Admin has not verified yet</td><td>Wait for admin</td></tr>
    <tr><td>Deposit Rows</td><td>Number of deposit rows in history/range</td><td>Use history to find mistakes</td></tr>
  </table>

  <h2>6. Daily Bank Deposit</h2>
  <p>Deposit entries explain where the station cash went. The most common mistake is putting the correct amount under the wrong sales date or wrong covered shift.</p>
  <div class="screen">
    <div class="screen-top">Daily Bank Deposit <span class="pill">Manager</span></div>
    <div class="grid four"><div class="fake-field"><span class="label">Deposit Date</span><b>2026-07-10</b></div><div class="fake-field"><span class="label">Sales Date Covered</span><b>2026-07-09</b></div><div class="fake-field"><span class="label">Covers</span><b>Shift 2 + Shift 3</b></div><div class="fake-field"><span class="label">Will Count Under</span><b>Shift 2, Shift 3</b></div></div>
    <div class="grid four" style="margin-top:8px"><div class="fake-field"><span class="label">Bank</span><b>BDO</b></div><div class="fake-field"><span class="label">Reference</span><b>123456</b></div><div class="fake-field"><span class="label">Amount</span><b>100000</b></div><div><span class="button green">Save Daily Bank Deposit</span></div></div>
  </div>
  <table><tr><th>Deposit situation</th><th>Deposit Date</th><th>Sales Date Covered</th><th>Covers</th><th>Why</th></tr>
    <tr><td>Deposit made today for yesterday Shift 2 and Shift 3</td><td>Today</td><td>Yesterday</td><td>Shift 2 + Shift 3</td><td>One deposit covers two shifts</td></tr>
    <tr><td>Deposit made today for all shifts of one sales date</td><td>Today</td><td>Sales date</td><td>All Shifts</td><td>One combined deposit, not three separate entries</td></tr>
    <tr><td>Deposit made today for today Shift 1 only</td><td>Today</td><td>Today</td><td>Shift 1</td><td>Only one shift covered</td></tr>
  </table>
  <div class="callout warn"><b>Combined deposit rule:</b> If one bank deposit covers many shifts on the same sales date, enter it once with the correct coverage. Do not enter the same amount three times.</div>
  <div class="callout bad"><b>If one real bank transaction covers two sales dates:</b> split it by sales date so reports count correctly. Example: one entry for yesterday Shift 2 + Shift 3, and one entry for today Shift 1. Use the same bank/reference if needed, but do not combine two sales dates into one row.</div>

  <h2>7. Liloan Reference Field</h2>
  <p>For Liloan, the reference label may show as <b>Minutes and Seconds</b>. Enter the bank/reference detail required for that station. For other branches, use the normal bank reference number.</p>

  <h2>8. Deposit History</h2>
  <p>Use Deposit From and Deposit To to check saved deposits for your station. Default range is the last 7 days.</p>
  <div class="screen"><div class="screen-top">Deposit History <span class="pill">Manager can see own station only</span></div>
    <table><tr><th>Sales Date</th><th>Counted Shift</th><th>Deposit Date</th><th>Bank</th><th>Amount</th><th>Status</th><th>Action</th></tr>
      <tr><td>2026-07-09</td><td>Shift 2 + Shift 3</td><td>2026-07-10</td><td>BDO</td><td>100000</td><td>Pending</td><td>Request Change / Removal</td></tr>
      <tr><td>2026-07-08</td><td>Shift 1</td><td>2026-07-08</td><td>BPI</td><td>58000</td><td>Verified</td><td>Request Change / Removal</td></tr>
    </table>
  </div>
  <div class="grid four">
    <div class="card"><span class="label">Pending</span><strong>Saved, not verified</strong><p class="note">Admin has not confirmed the bank yet.</p></div>
    <div class="card good"><span class="label">Verified</span><strong>Admin confirmed</strong><p class="note">Bank deposit is accepted.</p></div>
    <div class="card warn"><span class="label">Change Requested</span><strong>Waiting admin</strong><p class="note">Detail is wrong, but not changed yet.</p></div>
    <div class="card bad"><span class="label">Removal Requested</span><strong>Waiting admin</strong><p class="note">Wrong/duplicate row needs removal.</p></div>
  </div>

  <h2>9. Request Change Or Removal</h2>
  <div class="grid two">
    <div class="card good"><h3>Request Change</h3><p>Use when the deposit is real but some detail is wrong: amount, bank, reference, date, or coverage.</p></div>
    <div class="card warn"><h3>Request Removal</h3><p>Use when the deposit should not exist: duplicate entry, wrong station, or completely wrong sales date.</p></div>
  </div>
  <div class="callout bad"><b>Do not secretly fix deposit history.</b> Press Request Change or Request Removal and wait for admin approval.</div>

  <h2>10. Troubleshooting</h2>
  <table><tr><th>Problem</th><th>Meaning</th><th>Manager action</th></tr>
    <tr><td>Cashier says pump price missing</td><td>Sold liters exist but no price was saved</td><td>Enter correct fuel price and confirm</td></tr>
    <tr><td>Cashier cannot submit</td><td>Missing price, missing previous shift, or wrong required field</td><td>Check prices first; if price is okay, ask admin to inspect missing shift/correction</td></tr>
    <tr><td>Wrong branch selected</td><td>Data may save under another station</td><td>Stop and choose correct branch before saving anything</td></tr>
    <tr><td>Sales look wrong after price change</td><td>Mid-shift price-change reading may be wrong</td><td>Check effective time, new price, and every product nozzle reading</td></tr>
    <tr><td>One bank transaction covers multiple dates</td><td>One row cannot correctly describe two sales dates</td><td>Split entries by sales date, using the correct covered shifts</td></tr>
    <tr><td>Deposit appears under wrong shift</td><td>Coverage or sales date was wrong</td><td>Request Change</td></tr>
    <tr><td>Deposit entered twice</td><td>Duplicate deposit</td><td>Request Removal for wrong duplicate</td></tr>
    <tr><td>Reference wrong</td><td>Deposit may be hard to verify</td><td>Request Change with correct reference/minutes-seconds</td></tr>
    <tr><td>Pending verification</td><td>Admin has not approved bank deposit yet</td><td>Wait or ask admin to verify</td></tr>
  </table>

  <h2>11. Final Manager Checklist</h2>
  <ul class="checklist"><li>Correct branch selected</li><li>Correct price effective date</li><li>Daily vs Shift coverage correct</li><li>Premium price entered</li><li>Regular price entered</li><li>Diesel price entered</li><li>Confirm Fuel Prices pressed</li><li>Mid-shift price change used only if needed</li><li>Price-change time correct</li><li>Price-change register readings complete</li><li>Deposit Date correct</li><li>Sales Date Covered correct</li><li>Covers/shift coverage correct</li><li>Split deposit by sales date when needed</li><li>Bank/reference entered</li><li>Amount entered once</li><li>Request Change/Removal used for mistakes</li><li>Deposit history checked when unsure</li></ul>

  <h2>Sticker Reminders - Manager</h2>
  <div class="sticker-sheet"><div class="sticker"><h3>Fuel Prices</h3><ul><li>Set effective date.</li><li>Daily unless one shift only.</li><li>Enter P/R/D.</li><li>Press Confirm Fuel Prices.</li></ul></div><div class="sticker"><h3>Mid-Shift Price</h3><ul><li>Only if price changed during shift.</li><li>Enter exact time.</li><li>Enter pump reading at change time.</li></ul></div><div class="sticker"><h3>Deposit</h3><ul><li>Deposit Date = bank day.</li><li>Sales Date = sales day.</li><li>Covers = shift/s included.</li></ul></div><div class="sticker"><h3>Wrong Deposit</h3><ul><li>Request Change for wrong detail.</li><li>Request Removal for duplicate/wrong deposit.</li><li>Wait for admin.</li></ul></div></div>
`;

const files = [
  ["fueltech-cashier-training-guide.html", doc("Cashier Training Guide", "cashier", cashierBody)],
  ["fueltech-manager-training-guide.html", doc("Manager Training Guide", "manager", managerBody)],
];

for (const [file, contents] of files) {
  fs.writeFileSync(path.join(outDir, file), contents, "utf8");
  console.log(path.join(outDir, file));
}
