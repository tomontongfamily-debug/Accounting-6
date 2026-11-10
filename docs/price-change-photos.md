# Price-change photo workflow

The manager creates the product, effective time and new price for the correct shift. The photo workflow opens the first unfinished nozzle, offers Previous/Next and direct nozzle buttons, and advances after a successful reading confirmation. Cards remain mounted when moving between nozzles, so background OCR and kept upload retries survive navigation. Camera capture/upload temporarily disables nozzle switching; recognition alone does not.

The manager's **Unfinished price changes** panel lists saved changes across all shifts for the station and selected date. It shows confirmed counts and the next missing nozzle. Opening a task selects its saved date/shift, expands its card and scrolls to it. This covers the Nov 10 Barili video: a blocked Shift 1 change at 11:26 must remain reachable after the manager page defaults to Shift 2. Blank optional drafts do not appear as recovery tasks. The current shift is labelled next to the price-change section, and submission errors identify the report date/shift as well as the nozzle.

Cashier phones show a separate **Photos for** selector for saved, unconfirmed price changes. Cashiers can save and confirm those nozzle readings or choose the original price-change photos from their phone. They cannot create/change price metadata or confirm the selling price. The manager reviews and confirms the completed change. Closing readings and their photos remain separate.

Price photos must belong to the same station, shift, change, product, effective time and nozzle. Revision and submission/correction locks remain enforced. Price-change photo saves merge independently into desktop drafts, preserving cash, tank and manager edits. Changing product/time invalidates reuse of evidence from the old context. A blank optional change is not a photo task. A submission error names the next missing nozzle.

If dispensing resumed before the price-change readings were captured, later closing photos cannot establish the missing price boundary. Recover original photos taken at the change time and verify them; do not manufacture readings or mark missing evidence confirmed.

## Temporary Barili manual recovery

The owner explicitly authorized direct manual input for Barili's latest saved price change on November 10. `temporary-price-reading.js` pins this exception to `Barili__2026-11-10__shift-1`, change `f5zzz9s`, Premium at 11:26, new price 91.90. It never follows a future change or applies to opening/closing readings. Input closes when the manager confirms that change or at November 11, 2026, 17:30 Asia/Manila. Already saved, authorized manual evidence remains valid for later review/submission.

The separate `temporary-price-reading` action checks station/role, exact context, server time, revision and opening/closing/time-order bounds. It stores the staff-confirmed value with a server-generated authorization/time/role/nozzle record. Original photos/OCR evidence remain intact; missing photos and OCR readings are never fabricated. Manual entries are labelled in the capture screen and Admin price-change report and logged as `price-change-manual-reading-saved`. Manager price confirmation and final cash/source/submission checks remain required. Navigation and deployment do not insert any readings.

`pilot-temporary-manual-price.test.mjs` verifies scoped authorization, expiry/confirmation closure, invalid/forged requests, retained original evidence, preserved closing rows and successful manager confirmation/submission. The browser test exercises cashier phone and manager desktop manual entry without camera/OCR and retries a lost response using the same receipt ID.

Validation: `pilot-price-photo-handoff-ui.test.mjs` exercises all six Barili Premium nozzles with one already complete, slow background OCR, failed upload/same-ID retry, manual review, reload/resume and cashier-to-manager price confirmation. It verifies all 18 closing rows/photos stay intact. The API handoff and phone-sync tests cover role/station/context/revision locks, incomplete evidence and preservation of newer evidence/local edits. Tests use isolated fixture data, never production writes.
