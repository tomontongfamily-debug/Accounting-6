# Liloan October 3 launch

The owner authorized a fresh Liloan reporting period from October 3, 2026 at 04:00 Asia/Manila, using the October 2 Shift 3 closing readings as openings. Historical reports remain saved. Other stations keep the existing application.

Use `/pilot/cashier`, `/pilot/manager`, `/pilot/admin` and `/pilot/approver`, with existing production PINs. `/liloan-guide.html` is the printable station guide. Before cutover, finish October 2 Shift 3 in the original app. The new application waits for both 04:00 and complete submitted pump/tank readings before initializing live state. Once initialized, it retains that opening snapshot.

## Configuration and data

`fueltech_pilot_config` controls the mode and start date. The October launch uses `mode=live`, `start_date=2026-10-03`, and a new live state; the September shadow state is never promoted. At initialization, existing official reports at or after cutover cause a conflict instead of an overwrite. The database guards the live reporting boundary against legacy endpoint writes.

The source database connections are server-only. Production requires the existing Accounting service key/session/PIN configuration plus `FUELTECH_CV_URL` and `FUELTECH_CV_SERVICE_ROLE_KEY`. `VITE_PILOT_PREVIEW=1` is preview-only. No credentials or trial data are in this repository.

CV approvals, liquidations and clearances deduct gross cash once at the original approval time. Explicit cancellation or decline removes the CV deduction from new-system reports, including submitted reports, with an audit event. It preserves the physical cash count and recomputes variance. An unexplained source disappearance or changed amount still requires review. Missing payment-time evidence is never replaced with notification-arrival time. Pay, PO and CV all use Accounting's Manila shift boundaries, including the preceding business date for overnight Shift 3.

Original admin reads preserve pilot PO snapshots. Pilot deposit coverage and cash remaining are mirrored with reports so existing owner summaries use the same cash balances. Historical deposits remain in their original workflow; staff must identify old undeposited cash separately.

## Backups

Before activation, 194 Liloan reports and 23 price rows were exported and restored in an isolated database. Trial photos were exported and verified by SHA-256. The preparation files are on the owner's computer, outside this repository.

Photos are private in Accounting and automatically copied to the separate CV project's `fueltech-accounting-backups` bucket. A saved photo requires a verified identical backup copy. The existing nightly backup job also exports the database snapshot to that private bucket. Backups are retained; no automatic deletion is configured. This is a separate Supabase project/region, not a separate provider account.

The Accounting migrations are in `supabase/migrations`. The separate Storage migration in `supabase/cv-migrations` applies only to CV project `ncmptgqsumxgardylnhc`. Do not apply it to Accounting. A restrictive Storage policy prevents normal client roles from reading or writing backup objects even if another application has a permissive policy.

## Verification and rollback

Run `npm test`, `npm run build`, `npm run test:pilot`, `npm run lint` and `npm run typecheck`. Browser tests use installed Edge. Hosted shadow checks verified phone-to-PC reads, private photo bytes, duplicate retries, stale-write rejection and submission blocking. Physical pump OCR and a real PO transaction still need station acceptance; POS redemption remains manual.

Original production before this release: `accounting-6-o0j9qgt5z-tomontongfamily-4989s-projects.vercel.app` (Git commit `649f57db079e905eb367b774ec61a4c2f404534a`). To stop before live writes, disable the pilot configuration and restore the previous deployment if necessary. After live writes, pause submissions and export current reports/state/photos before changing mode or deployment. Preserve new legitimate records; do not overwrite them with the older baseline.
