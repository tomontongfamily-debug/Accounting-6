# Liloan POS redemption connection

Accounting reads `public."Withdrawals"` in Fueltech Discount Pos, project `zuhvemesqznmbbpzudib`, using a dedicated PostgreSQL login. YTL is the owner-confirmed code for Liloan. No customer or employee fields are imported. POS source data and application code are unchanged.

The owner approved creating read-only access on October 7, 2026. Access setup added `fueltech_accounting_reader` and station-scoped SELECT policies; it did not change existing roles or their policies. The role has no memberships, administrative privileges or RLS bypass. Its permitted fields are WithdrawalId, WithdrawalDate, Type, CokeQuantity, RedeemedPoints and OrgCode in Withdrawals; TransactionId, TransactionDate, OrgCode, Discount and Liter in Transactions; and TransactionDate, OrgCode, Discount and Liter in VoidedTransactions. Customer balances, customer IDs, QR codes, user IDs and employee fields remain inaccessible. It has no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER grants. RLS restricts its rows to `OrgCode = 'YTL'`. Default transactions are read-only; connection limit is 6, statement timeout 8 seconds, and idle transaction timeout 10 seconds.

## Accounting settings

Production-only backend environment variables:

- `FUELTECH_POS_REDEMPTIONS_ENABLED=true`
- `FUELTECH_POS_READ_DATABASE_URL`: the dedicated reader connection, stored as a Vercel Secret. Its IPv4 transaction pooler hostname was verified in this project's Connect dialog: `aws-0-ap-northeast-1.pooler.supabase.com`, port 6543; user `fueltech_accounting_reader.zuhvemesqznmbbpzudib`, database postgres.
- `FUELTECH_POS_CA_CERT`: the official root certificate downloaded from the POS Database Settings page. TLS verifies the certificate and hostname; insecure SSL URL options are rejected.

Never use postgres, service_role or a POS service key for this connector. Passwords and private audit evidence are excluded from Git. Shadow and Vercel preview modes do not contact POS. Setting the enable flag to false and redeploying pauses POS reads and labels cached evidence as paused.

Each read validates its login, RLS, role memberships, administrative privileges, write grants, executable security-definer functions and access to customer/employee fields. A privilege expansion fails the read before any redemption query. Source rows are selected with fixed parameterized SQL inside one repeatable-read, read-only transaction, with keyset pagination (1,000 rows per page; 20,000 maximum). An incomplete, invalid or failed read never replaces the last successful copy with zero.

## Accounting behavior

Refresh occurs when a live Liloan report or the Admin report store is loaded, at most once per minute in saved state; cash reconciliation and submission request a fresh read. This is an on-demand feed, not a background scheduler. Accounting stores its own evidence copy and source fingerprint audit entries. Completed reports are refreshed too, so late, amended or removed POS records appear as evidence changes.

Manila boundaries are Shift 1 04:00–13:00, Shift 2 13:00–22:00, Shift 3 22:00–04:00 the next day. Events before 04:00 belong to the preceding business date. Source IDs deduplicate records. Unknown types, conflicting IDs, invalid amounts, missing timezone or rows outside the station/window invalidate the copy.

POS Type Cash combines monetary cash and fuel redemptions. Accounting owns one `deductions.posRedemption` total and sets the old manual cash/fuel deduction fields to zero to avoid counting them twice. Cashiers cannot replace source totals. Coke quantity and redeemed points remain a separate CV reference; existing vouchers already supply the cash deduction. Cash counts, pump photos/readings, saved shift prices, CV/Pay/PO records and bank deposits are preserved. Expected cash, physical variance and cash-variance flags are recalculated. Original manual deductions and before/after totals are preserved in adjustment metadata and Accounting audit records.

The owner authorized updating all 14 submitted reports, including the October 2 pre-cutover shift. The Accounting commit migration permits only POS fields, resulting checks and audit/version metadata to change on existing pre-cutover submitted reports. Historical cash counts, pumps, prices, unrelated deductions and user edits remain protected. Later daily prices no longer reprice submitted Liloan shifts in Admin views.

Points Issued uses customer-earned `Transactions.Discount`, not employee salesperson points. Current POS evidence shows Discount equals the customer balance increment. Approved MultiTransactions are already represented in Transactions with different IDs and must not be added again. Voiding leaves the original transaction in Transactions, so the reader checks exact station/time/Discount/Liter matches in VoidedTransactions. An ambiguous void or invalid points/liters flags that shift and retains its prior points value; automatic monetary redemptions still apply. Fractional points are summed before rounding the shift total to two decimals. Points Issued does not deduct cash.

A failed or stale monetary read blocks cash reconciliation and submission until refreshed. Draft saving remains available and retains the last successful deduction. Missing POS evidence never becomes a zero result. Points anomalies flag Admin review rather than preventing cash submission.

The cashier sees the comparison under Deductions. Both Admin screens show it in the selected shift report. Transaction details contain only IDs, times, type, amounts and Coke quantity. Unavailable or paused evidence is clearly marked with the last successful verification time. Disabling the connection retains the Accounting evidence history.

## Verification and recovery

Automated checks cover timezone boundaries, deduplication, invalid data, financial preservation, unavailable/recovery behavior, privilege validation, read-only pagination, source immutability, server-owned metadata, and phone/desktop display. An isolated PostgreSQL test verifies RLS, column isolation and denied writes. Live tests logged in with the actual reader, saw only YTL, rejected other-station queries and customer/other-table access, and rejected non-executing EXPLAIN INSERT/UPDATE/DELETE probes. No write probe was executed against POS data.

For activation verify the live Accounting POS comparison and its last verification time. Compare every submitted report against its pre-activation Accounting backup: only automatic monetary redemption deductions, points, resulting variance/checks and source/audit/version metadata should change. Check state and canonical report copies together. If unavailable, review host, certificate, credentials and role grants without broadening permissions. To retire access, pause Accounting first, then an authorized POS administrator can disable LOGIN or drop the SELECT policy and dedicated role. Do not change existing POS roles.
