# Liloan POS redemption connection

Accounting reads `public."Withdrawals"` in Fueltech Discount Pos, project `zuhvemesqznmbbpzudib`, using a dedicated PostgreSQL login. YTL is the owner-confirmed code for Liloan. No customer or employee fields are imported. POS source data and application code are unchanged.

The owner approved creating read-only access on October 7, 2026. Access setup added `fueltech_accounting_reader` and one SELECT policy; it did not change existing roles or their policies. The role has no memberships, administrative privileges or RLS bypass. Its six permitted fields are WithdrawalId, WithdrawalDate, Type, CokeQuantity, RedeemedPoints and OrgCode. It has no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER grants. RLS restricts its rows to `OrgCode = 'YTL'`. Default transactions are read-only; connection limit is 6, statement timeout 8 seconds, and idle transaction timeout 10 seconds.

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

POS Type Cash combines monetary cash and fuel redemptions. Accounting compares its cash + fuel deductions with this total and raises a REDEMPTION check when they differ. The cashier keeps control of the split. Coke quantity and redeemed points are shown separately for CV review; they do not add another deduction. Existing cash counts, deductions, prices, pumps, vouchers, deposits and computed balances are preserved. Source discrepancy warnings do not prevent saving or submitting a shift.

The cashier sees the comparison under Deductions. Both Admin screens show it in the selected shift report. Transaction details contain only IDs, times, type, amounts and Coke quantity. Unavailable or paused evidence is clearly marked with the last successful verification time. Disabling the connection retains the Accounting evidence history.

## Verification and recovery

Automated checks cover timezone boundaries, deduplication, invalid data, financial preservation, unavailable/recovery behavior, privilege validation, read-only pagination, source immutability, server-owned metadata, and phone/desktop display. An isolated PostgreSQL test verifies RLS, column isolation and denied writes. Live tests logged in with the actual reader, saw only YTL, rejected other-station queries and customer/other-table access, and rejected non-executing EXPLAIN INSERT/UPDATE/DELETE probes. No write probe was executed against POS data.

For activation verify the live Accounting POS comparison and its last verification time. Check submitted report monetary fields against a pre-activation Accounting backup. If unavailable, review host, certificate, credentials and role grants without broadening permissions. To retire access, pause Accounting first, then an authorized POS administrator can disable LOGIN or drop the SELECT policy and dedicated role. Do not change existing POS roles.
