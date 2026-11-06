# Pump reader timing and recovery

The phone runs OCR locally while the photo uploads. Clear photos target a
result within 20 seconds. Every recognition attempt has a 30-second deadline,
including queue time. A deadline produces an explicit retry result rather than
leaving an active spinner. Unclear digits must not be guessed to meet a timer.

Use **Prepare faster readings** while connected before starting the pump round.
The primary worker, supported core and digit language are checked against pinned
hashes and saved in the browser cache. Advanced reader files are prepared
separately. Preparation also starts the image-analysis worker. Once prepared,
local recognition does not wait for the photo upload. A first download, browser
cache eviction, an extremely slow device or an unreadable photo can still prevent
a successful number within the target. Online saving requires a connection.

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
