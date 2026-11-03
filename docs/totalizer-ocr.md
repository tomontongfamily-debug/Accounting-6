# Pump totalizer OCR

## Automatic-reading revision (`lcd-neural-3`)

The browser now combines the existing seven-segment recognizer, a physical
eight-cell fit anchored by the visible decimal, and a local PP-OCRv5 English
neural model. The original color row is read at several resolutions. Per-digit
certainty is retained; one uncertain integer must not hide behind a high word
average. Different crops of one model do not count as independent recognizers.
No photo, opening reading, report identifier or known answer is supplied to the
recognition decision. All model inference stays in the browser.

Unresolved photos offer a closer retake without reflections first. Manual entry
remains an explicit override, and normal cashier confirmation remains required.
The live-camera guide encourages photographing the eight digits at a useful
size. Pump tabs are disabled while capture, recognition or saving is active so
switching pumps cannot discard an in-progress suggestion. Loading failures
remain recorded as errors, separately from uncertain images. No confirmed
accounting reading or historical OCR suggestion is rewritten by this update.

The model, extracted vocabulary, licenses and runtime binaries are checked at
build time. See `public/ocr/neural/README.md` for source and license details.
When updating cached model/runtime assets, change their URLs as well as their
version and integrity checks.

The benchmark figures below describe the earlier restrictive revision. They
must not be read as the automatic fill rate of this revision.

Final private validation covers all 752 current saved photos: 670 correct
suggestions and 82 abstentions in the complete built-browser replay, followed
by a complete replay of those 82 abstentions after the narrow-one corroboration
change. One additional photo then reads correctly: 671 automatic readings and
81 retakes overall, with no known incorrect suggestions against the reviewed
references. The earlier 670 accepted results are unchanged by that corroboration
change. All 29 original mismatch photos now read correctly.

The actual built phone-camera workflow was tested separately on all 29 original
mismatch photos: 29 correct automatic readings, no manual entry, no incorrect
suggestions, and fixture-only OCR persistence. Camera capture waits for video
frames, snapshots the original pixels for recognition before JPEG compression,
and finishes encoding before stopping the camera track. Uploaded evidence uses
high-quality JPEG with a size-bounded fallback. This also prevents capturing the
initial black video frame observed during validation. Historical images and
confirmed reports are not replaced by these tests.

The reference audit was corrected after independent inspection of one original
photo: a saved closing of 242525.10 had been incorrectly marked as matching a
photo displaying 242625.10. Regression references must come from the image;
ledger agreement alone does not prove OCR accuracy. The test set does not
establish perfect accuracy on unseen images or recover digits obscured by glare.

November 3 hardening (`lcd-frame-check-2`) requires the supported station LCD's six integer and two decimal cells, removes continuous frame strokes spanning the crop, and corroborates consensus candidates against digit geometry and the original LCD strokes. It rejects an extra decimal cell, including a trailing zero, rather than rounding an unverified digit. Corroboration runs after selecting the consensus candidate so rejecting it cannot promote a different, less reliable pass.

Private replay of all 752 current closing photos produced 174 correct suggestions and 578 abstentions, with no incorrect suggestions. Of the 29 historical OCR mismatches, 5 now read correctly and 24 request manual entry. Of the 450 photos with no historical OCR, 79 now read correctly and 371 request manual entry. This is a deliberate accuracy-versus-coverage tradeoff: substantially more photos need cashier transcription. These observed results do not guarantee accuracy on unseen images. Historical OCR numbers and confirmed accounting entries are not overwritten by a recheck. Private photos, expected readings and report identifiers are not shipped in the recognizer or committed here.

Each new photo starts with `ocr_result.status=pending`. Capture saves `detected`, `no-reading` or `error`, the recognizer version and completion timestamp. An interrupted browser can therefore leave an identifiable pending attempt. Previously exceptions and abstentions both became an indistinguishable null. Legacy nulls remain unknown; neither the absence of a number nor a modern recheck establishes the historical failure cause. A confirmation/edit on the same photo preserves the OCR suggestion and attempt, including when an older client supplies null. Retaking a photo clears the old confirmation and suggestion, while the upload audit records both photo paths and the previous OCR number. The same evidence handling applies to manager price-change photos.

The following earlier benchmark results describe previous recognizer revisions and their smaller photo sets; the current full-set results above supersede them for release assessment.

Stroke refinement must corroborate a newly added segment against the contrast of existing segments. This prevents faint reflections from overriding a correctly recognized 3 with 9 or 1 with 7. Physical strokes still recover real sevens and faint leading digits. Synthetic regressions cover both reflection failures; the private October 7 Shift 1 samples read 305355.94 and 284510.11. No photograph, pump identity, opening reading or known answer is used to select a value.

The October 7 regression set contains 104 real photos: 85 return the visually verified number and 19 abstain, with no wrong readings. The two fixed photos and the earlier genuine-seven sample were checked in their original form and compressed JPEG variants. At 1000px / quality 0.85, the trailing-one sample abstains because the passes do not agree; normal phone uploads at 1800px / quality 0.92 auto-fill correctly. A private sample's optional `variantExpected` map can explicitly require abstention for a named compression variant. Expected values are test assertions only, never recognizer inputs. Historical suggestions are retained as audit evidence.

One-versus-seven verification now refuses a digit when a possible top bar is visible at only one alignment. Repeated physical-stroke evidence can recover a seven; recognized sevens stay unchanged. October 4 Shift 2 photo #2 was checked as 392555.72 in its original form and four JPEG upload variants. Run this private-photo regression with `TOTALIZER_STATION_MANIFEST` and `TOTALIZER_UPLOAD_VARIANTS=1`; expected readings are assertions used only by the test, never inputs to recognition. Historical confirmed entries require an explicit audited correction and are not replaced by an OCR recheck.

Pump and manager price-change photos use the locally hosted `ssd_int` seven-segment model. Model provenance, original SHA-256, and Apache-2.0 license are beside the compressed model in `public/ocr/lang`. No external image-recognition service is called.

The browser normalizes local contrast, locates the LCD row using aligned digit strokes, and reconnects small segment gaps. Recognition must agree across layouts or repeated high-confidence passes with different stroke widths or padding. A tighter crop cannot discard digits identified in the wider crop. The decimal position must be supported by a visible dot near the digit baseline. Different plausible readings or missing decimal evidence leave the field for manual review. The recognizer receives only the photograph, never the opening reading or an expected answer. Cashier confirmation and all existing report validation remain required.

Detected values are saved as unconfirmed suggestions so switching pumps or reopening the shift retains them. Confirmed readings show a saved confirmation instead of requesting another entry. Desktop cashier screens refresh phone-owned pump evidence every 15 seconds and on focus or an existing change event, including while cash or tank drafts are unsaved. The merge preserves local cash/tank inputs and retains conflict protection for unrelated report edits.

Run `npm test`, `npm run test:pilot`, `npm run lint`, `npm run typecheck`, and `npm run build`. After building, the private regression photograph can be tested with `TOTALIZER_TEST_PHOTO` set to its local path and `node --test tests/pilot-totalizer-ocr-ui.test.mjs`. That test exercises the real model and mobile upload compression; it mocks accounting APIs and never writes to a station. The user photograph is deliberately excluded from this repository. The expected value for this regression is 439931.31.

Verification on the supplied glare photograph: automatic detection and confirmation succeeded through the built mobile UI. Unit tests also cover alternate decimal positions, uncertain digits, label rows, missing/ambiguous dots, blank images, and a lighting gradient. This verifies the supplied example, not every possible glare or display type; unreadable digits still require a clearer photo or manual review.

Eight saved station photographs were also tested in the real browser: six produced the visually verified reading and two remained unselected for manual review. Run this private-photo regression with `TOTALIZER_STATION_MANIFEST` pointing to a local JSON array of `{file, expected}` entries and `node --test tests/pilot-station-ocr-ui.test.mjs`. Use `expected:null` for ambiguous photographs. Neither the photos nor the manifest belongs in this repository. The desktop/phone regression uses mocked accounting APIs and confirms that an unsaved tank entry survives a phone confirmation, without a second confirmation on the desktop.
