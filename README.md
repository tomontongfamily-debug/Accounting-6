# Fueltech Branch Reporting Official Version

Stable no-Tailwind React/Vite app for station reporting.

## Included updates

- Each daily report has a Submit Shift Report button.
- Cashier and Manager have separate branch PINs.
- Admin access is protected by the configured production PIN.
- Official wording, no demo reminder text.
- Fuel price setup is daily, not per shift.
- Manager pricing carries forward to the next day until changed.
- Admin can select a date and view daily station summaries using the calendar.
- Admin has bank verification and Excel-style monitoring.
- Branch pump layouts follow the requested pump/nozzle setup.

## PINs

PINs are configured only in Vercel environment variables. Do not store live cashier, manager, or admin PINs in project files.

## Vercel settings

Framework: Vite
Root Directory: ./
Install Command: npm install
Build Command: npm run build
Output Directory: dist


## V2 admin/manager/cashier changes

- Admin side keeps Admin View, Bank Verification, Daily Station Summary, and Summary only.
- Admin does not submit cashier reports.
- Admin does not show Excel Spreadsheet Monitoring, Calendar Summary, or Fuel and Tank Registers.
- Manager does not submit cashier reports.
- Manager only confirms Daily Prices.
- Manager report date and summary range were removed from the top header.
- Manager can change date only inside Daily Fuel Price Setup.
- Cashier cannot change report date or summary range.
- Cashier shift is automatically based on the current time:
  - Shift 1: 6:00 AM to 2:00 PM
  - Shift 2: 2:00 PM to 10:00 PM
  - Shift 3: 10:00 PM to 6:00 AM
- Cashier pump reading table no longer shows Product category.


## V3 pump reading update

- Cashier no longer inputs Opening in the Pump Reading Register.
- The app now treats Opening as Previous Shift Closing.
- Cashier only inputs Current Closing.
- Liters Sold = Current Closing minus Previous Shift Closing.
- Product category remains hidden on the cashier pump table.


## V4 tank inventory update

- Cashier no longer inputs Opening in the Tank Inventory Register.
- The app now treats the previous shift's actual dip as the current shift's opening basis.
- Cashier only inputs Current Actual Dip, Delivery, Pull-Out, and Calibration.
- Tank variance formula:
  Current Actual Dip - (Previous Shift Dip + Delivery - Liters Sold - Pull-Out - Calibration)
- This matches the pump reading logic where Current Closing is compared with Previous Shift Closing.


## V5 admin summary and PIN update

- Admin now requires a PIN configured in Vercel environment variables.
- Admin Summary is now a larger period-based summary.
- Summary has separate Start Date and End Date controls.
- Summary totals include fuel sales, oil sales, gross sales, deductions, expected cash, bank deposit, confirmed bank, pending verification, PO, PR, cash variance, pump variance, tank variance, liters, and Coke count.
- Admin View, Bank Verification, and Daily Station Summary remain unchanged.


## V6 consolidated admin summary update

- Admin Summary is now clearly labeled as Consolidated Summary - All Stations.
- The big summary totals all branches within the selected start and end dates.
- No cashier or manager changes were made.
- Admin View, Bank Verification, and Daily Station Summary remain unchanged.
