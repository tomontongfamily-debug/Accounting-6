# Pump reader timing and recovery

## November 10: photo-derived checks and confirmed Mabolo format (`lcd-format-evidence-13`)

The available reviewed corpus contains 782 unique photos: 752 archived Liloan
references and 30 additional unique compatibility/recent station photos. The
88 unreviewed or superseded archive entries are not treated as ground truth.
The full previous-reader replay returned 619 correct automatic readings, 163
abstentions and no wrong numbers against those references.

This revision corrects several distinct failures:

- A narrow one joined to its neighbor can be separated only at a low-ink valley
  with two full-height cells, one narrow and one normal-width cell. No cell is
  discarded. Printed triangles beside the LCD are excluded only after their
  filled triangular shape is verified, including triangles at the photo edge.
  A presumed bezel or reflection alone never supplies permission to crop digits.
- Weak physical strokes can use a small classifier fitted to the reviewed
  examples, plus conservative shear/sensitivity checks. Alternative masks must
  retain the original cells and their alignment; an additional ninth cell stops
  rescue. Neural agreement remains necessary for new suggestions.
- OCR character boxes can overlap even when the complete physical row is clear.
  An interior alias needs independently rebuilt physical cells, a visible
  decimal, regular spacing and qualified primary evidence. A fitted grid can
  alternatively prove eight complete cells only with strong scores for every
  cell, matching physical landmarks, and no outside hinted digit. Every actual
  ninth physical cell still blocks this eight-cell fallback.
- Six/seven-digit neural strings remain unscaled until physical decimal/count
  evidence supplies their format. This prevents discarding correctly recognized
  short counters simply because the neural model missed the decimal point.

On November 10 the owner explicitly confirmed that Mabolo uses five integer
digits and two decimal digits. The cashier camera, Opening Setup and mid-shift
capture therefore pass only that verified format to the reader. A missing dot
can use this format; missing digits cannot. Seven complete physical cells and
independent recognition agreement are still required. A visible contradictory
decimal, an extra cell, a printed arrow, conflicting readings or uncertain digits
cannot be repaired by this profile. Other stations keep photo-based decimal
validation. No opening value or expected counter number enters recognition.

A single qualified primary pass for the confirmed format needs all three neural
resolutions, word score at least .99 and every integer/fractional digit at least
.98. Repeated primary evidence retains the existing strict two-resolution neural
gate. Different resolutions of the same neural model are not independent engines;
the primary/physical reader supplies the independent corroboration.

New attempts retain `formatProfile: mabolo-five-two-20261110` in OCR evidence.
Automatic Mabolo suggestions show both decimal digits, including `.00`. Cashier
confirmation remains required. Existing confirmed readings are not rewritten.
Unconfirmed failed photos can use **Retry automatic reading** after refreshing.
The read-only phone diagnostic also offers the verified Mabolo format explicitly.

The classifier uses 2,728 aligned glyphs from 341 photos in the older 500-photo
partition. Validation uses 1,384 glyphs from 173 eligible photos in the remaining
partition. Its runtime gates resolve 74 previously undecided validation glyphs
with no wrong accepted glyphs; these digit-level figures are not meter accuracy.
An ablation on 15 recovered photos kept all 15 readings without the classifier,
with one needing the grid instead of the physical-only corroborator. Recovery
claims are based on complete-photo results, not classifier scores. Only aggregate
coefficients ship; private photos, counter sequences and training features do not.

Validation covers the full 782-photo replay, a complete replay of its 163
abstentions after the marker refinement, and the calibrated recent-station set.
Together the validated cases yield 637 correct automatic readings, 145 abstentions,
zero wrong numbers and no lost prior successes. The newer 282-photo partition
improves from 204 to 214 correct readings. The selected recent set (four photos
per station) improves from 10/24 to 17/24; its failures fall from 14 to seven.
Mabolo improves from 1/4 to 4/4. These are regression-set results, not a measured
production failure rate or a guarantee for every new photo/device.

The actual built camera → OCR → fixture API → saved format evidence → explicit
cashier confirmation flow passes on the no-dot Mabolo photos, including
25,065.00 and 27,167.61. The original 30-second deadline, worker recovery, offline
preparation, format guards, model-integrity gate and data-preservation gate remain
in force. Inference stays on the device; model/runtime assets are unchanged.

Reproduce glyph fitting with an ordered private `{file, expected}` manifest:

```powershell
node scripts/extract-totalizer-glyphs.mjs private-manifest.json private-features.json
node scripts/train-totalizer-glyphs.mjs private-features.json weights.js
```

The first 500 photos are the training partition; remaining photos are reserved
for validation. The supplied manifest must preserve that ordering. The benchmark
can additionally use `branch` to apply the same owner-confirmed station format as
the app. `TOTALIZER_GLYPH_ABLATION=1` disables only the glyph classifier in the local
benchmark; it is not a product setting. Private inputs/results stay out of Git.

## November 9: bounded resolution rescue (`lcd-format-evidence-12`)

Recognition keeps the existing 1280-pixel first pass. Only an abstention can
try the original photo again at up to 1800 pixels, with at least eight seconds
remaining in the same 30-second deadline. A successful first pass returns
immediately. Every higher-resolution result needs repeated primary agreement,
physical decimal/layout evidence, and two confident neural resolutions. Any
decoded conflicting neural view rejects the rescue. Physical and unexplained
OCR nine-cell guards still block the fallback; extra digits are never dropped.

Four/five-integer displays may also recover when complete independent cells
contain an undecided binary stroke. Repeated qualified primary passes, the
physical two-place decimal, no conflicting physical digit, and the same strict
neural agreement are required. The neural decoder accepts shorter counters
only with an explicit two-place decimal. It never pads hidden zeros. Photo
inference stays local; cashier confirmation and accounting records are unchanged.

The exact same 62 private reference photos were replayed before and after:
38 historical/compatibility/Barili examples plus 24 recent photos, four from
each of six stations. Correct automatic readings increased from 31 to 39;
abstentions fell from 31 to 23, with zero incorrect suggestions in either run
and all 31 prior successes retained. This is a selected regression corpus,
not a measured production failure rate. The reflection-heavy Barili example
still abstains when primary and neural readers disagree on the last digit.
The separate-row Moalboal overflow counter also remains unverified.

Two recovered photos additionally passed the built camera → OCR → fixture API
save → explicit cashier confirmation flow, including the five-integer counter.
Worker/deadline/format/background browser checks passed (six tests; Firefox and
WebKit skipped because those engines are unavailable). A seven-photo replay
with 4× desktop CPU throttling returned five correct readings and two intended
abstentions, no errors or wrong suggestions. This does not establish physical
phone timings. Unit tests (369), lint, typecheck, production build, and the data
preservation/model integrity gates passed.

Reproduce locally with private `{file, expected}` manifests; expected readings
are used only by the harness after recognition and never supplied to the reader:

```powershell
node scripts/benchmark-totalizer.mjs manifest.json results.json baseline.json
$env:TOTALIZER_TEST_PHOTO = '<absolute path to reference photo>'
$env:TOTALIZER_TEST_EXPECTED = '<independently verified reading>'
node --test tests/pilot-totalizer-ocr-ui.test.mjs
```

The comparison fails on a wrong suggestion, reader error, lost baseline
success, or lack of improvement. Keep private manifests, photos and results
outside version control. Optional `TOTALIZER_CPU_THROTTLE=4` is a desktop
emulation check only.

The phone runs OCR locally while the photo uploads. Clear photos target a
result within 20 seconds. Every recognition attempt has a 30-second deadline,
including queue time. A deadline produces an explicit retry result rather than
leaving an active spinner. Unclear digits must not be guessed to meet a timer.

Preparation starts automatically when the phone cashier view opens, before the
shift report finishes loading. There is no preparation button. The primary
worker, supported core and digit language are checked against pinned hashes and
saved in the browser cache first. The larger advanced reader prepares afterward,
including on slow connections and with data saver enabled. Failed preparation
retries automatically with capped backoff and on reconnect or returning to the
page. Multiple pump panels share one preparation job.

Background downloads have separate limits from engine startup and recognition:
five minutes for primary files and ten minutes for advanced files. A photo's
30-second deadline does not discard an ongoing background primary download.
Preparation also starts the image-analysis worker. Once prepared, local
recognition does not wait for the photo upload. A first download, browser cache
eviction, an extremely slow device or an unreadable photo can still prevent a
successful number within the target. Online saving requires a connection.

An upload records a pending attempt with start/deadline timestamps. Browser OCR
completion is saved separately. Closing the page, losing a response or an older
unbounded worker could historically leave only the pending marker. The phone now
keeps unfinished captures and completed OCR results in device-local IndexedDB.
Reload offers a retry with the original request IDs and revisions; completed OCR
does not run again. A pending saved photo can also retry recognition directly.
If another device has replaced the photo, server revision checks reject the old
capture. Late OCR completion cannot restore a discarded or superseded capture.

Photo and OCR saves do not confirm a financial reading. The cashier checks the
photo and confirms the number. A manual confirmation without a completed OCR
result records `recognition-interrupted`, retaining the cashier's number and a
null automatic reading. Completed evidence cannot be downgraded by stale pending
saves. Historical reports are not rewritten by this release.

Verification covers real browser workers under the production CSP, prepared
reader behavior with network requests blocked, cache integrity, timeout/worker
recovery, interrupted uploads, reloads, lost responses and concurrent revisions.
Private reference photos may be benchmarked without adding them to the repo:

```powershell
$env:TOTALIZER_PRIMARY_PHOTO = '<absolute path to original JPEG>'
$env:TOTALIZER_PRIMARY_EXPECTED = '<verified reading>'
node --test tests/pilot-primary-offline-ui.test.mjs
```

Desktop browser timings are evidence for that test environment, not guaranteed
latencies for every cashier phone. Four/five-digit integer displays require the
same physical-digit and visible two-place decimal checks as longer totalizers.

An OCR pass can split one narrow LCD digit into two glyphs. OCR-derived nine-cell
hints are evaluated after all existing crop passes. An independently verified
eight-cell row, its visible six-plus-two decimal and a qualified agreeing OCR
pass may explain an interior split. Every physical nine-cell row and every
unexplained extra glyph still blocks the eight-cell fallback. Explaining a split
adds no reading or vote; the existing grid/neural consensus remains required.
Small OCR box borders may extend beyond the ink, but glyph centers stay inside
the original cell ranges. The proof rejects oversized glyphs, wide merged cells,
outside-leading centers and splits in the first or last physical cell.

## Real-phone acceptance testing

`/ocr-phone-check.html` loads the same production OCR modules without station
sign-in or accounting API calls. It prepares automatically, accepts local photo
files and records each reading, explicit no-reading/error, duration, reader
version, preparation timeline and reported device/network details. Photo bytes
stay in the browser. Exported results contain filenames and readings, not photos.
The device label is operator-supplied; a mobile user agent alone does not prove a
physical phone was used.

Use a physical-device service such as Sauce Labs **Mobile Real**, not its Mobile
Virtual emulator or a desktop mobile viewport. Run Android Chrome and iPhone
Safari with normal Wi-Fi, constrained bandwidth/high latency, interrupted
connectivity, and prepared offline recognition. Include cold preparation and
already-prepared sessions, the original Pump 4 photo, current reflected/glare
photos, and an unreadable case. Compare exact digits against a separately
reviewed reference. Record no-reading and wrong-reading rates alongside median,
p95 and maximum latency. A timeout or quick refusal is not a successful reading.

The automatic-preparation change has unit and build validation. Physical-phone
timings and the glare/network acceptance matrix remain unverified until a
signed-in device-lab session is available. Do not substitute desktop timings.
