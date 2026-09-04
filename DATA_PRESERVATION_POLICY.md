# Live Data Preservation Policy

- Deployments must not delete, reset, hide, or overwrite live accounting records.
- Reports, deposits, bank verification, prices, corrections, and audit information remain in Supabase across app updates.
- Production report or price deletion is forbidden in normal runtime APIs.
- The historical visibility boundary cannot move forward without an explicit, reviewed change.
- The Liloan opening-setup reset requires an authenticated admin, an exact target, an explicit confirmation phrase, and a visible browser confirmation.
- Diagnostic cleanup may delete only records created by that diagnostic run.
- Nightly backups must remain enabled.
- Any intentional live-data deletion requires the owner's explicit approval naming the branch, dates, shifts, and record type.
