# Pump reader timing and recovery

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
