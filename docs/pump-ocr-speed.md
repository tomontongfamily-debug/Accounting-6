# Pump photo recognition speed

The `lcd-phone-bounded-6` reader reduces waiting while preserving the previous
reader's acceptance and confirmation rules. It does not rewrite saved readings.

## Minute-long waits on phones

The earlier computer benchmark measured recognition only. It did not establish
the managers' capture-to-saved-reading latency. Investigation found:

- Primary worker startup and jobs could hang indefinitely and hold every later
  photo in the serial recognition queue. A vendor worker crash after startup
  did not reject outstanding jobs.
- Loading 22.7 MB of public fallback files had no elapsed deadline. On a slow
  connection that wait occurred before the worker's initialization timeout.
- Photo/reading saves could refresh unrelated financial sources across all six
  stations when the source snapshot was over one minute old.
- A slow background pump-report poll occupied the same queue as photo writes.
- Recent saved reports included old reader versions, so publishing a build did
  not establish that every manager's already-open page was using it.

Evidence-only actions now retain committed financial summaries and skip global
source/POS imports. Cash checks, report submission and explicit source refreshes
retain their verification. Primary photo storage and independent immutable backup
verification still complete before the photo commit. Pump polls wait existing
writes but cannot block later photo writes or confirmations.

Recognition has a 15-second deadline including queue wait. A stalled attempt
returns an error/retry outcome, never an invented number. Owned worker handles
allow termination and recovery; expired jobs cannot resume late inference or
overwrite a later capture. Background preparation has a separate finite budget
so slow first-time downloads can finish without forcing each photo to wait for
them. Public fallback-file preparation is bounded at 90 seconds.

Browsers without working live camera access offer native camera capture. The
fallback avoids createImageBitmap and still preserves the original confirmation
and photo revision checks. A failed automatic attempt can retry the saved capture
without uploading a replacement. The UI identifies photo saving separately from
recognition and stores bounded stage durations for later diagnosis.

Chromium and WebKit desktop-engine tests exercise these paths with a phone-sized
viewport, unavailable camera APIs and blocked persistent storage. These tests do
not reproduce physical phone CPU, camera or mobile-network performance. Firefox
could not start on the test host because of a Windows runtime assembly error;
Firefox phone compatibility remains unverified.

## Changes

- When independent OCR and all nonempty neural views agree, apply the existing
  digit-confidence checks before skipping the geometry search. Conflicts still
  go through the full physical-cell checks.
- Retain the same best 400 geometry layouts in a stable bounded heap. Stop
  sampling layouts whose accumulated error already exceeds the retained set.
  Reuse numeric scratch storage instead of allocating it for every layout.
- Run geometry, neural tensor preparation and inference in one reusable worker.
  A worker failure rejects its pending requests and the next attempt starts a
  fresh worker. Photo and cached-model buffers are retained for recovery.
- Prepare both downloaded files and the actual neural session before displaying
  “Reader ready.” Cached files and explicit Wi-Fi preparation remain supported;
  slow connections and data-saving mode do not trigger the large download.
- Prefer a 1920 × 1080 rear-camera stream where supported. These are optional
  preferences, so lower-resolution cameras remain usable. Preserve the full
  frame, decimal and leading-digit safeguards.

## Validation

Compared against main commit `3580238` using 752 independently audited private
station photos. Expected readings are assertions outside the recognizer; they
are never recognition inputs. Include the audited photo correction at index 387.

| Result | Previous reader | Updated reader |
| --- | ---: | ---: |
| Automatic readings | 581 | 581 |
| Retake/manual review | 171 | 171 |
| Known incorrect suggestions | 0 | 0 |

Every individual result matched. Two difficult photos took approximately
3.49 / 3.29 seconds before and 1.37 / 1.29 seconds after in sequential local
browser profiling. These are measurements on the development computer, not
guarantees for a station phone. Recognition timing excludes photo transfer and
station saving. Production-bundle testing also exercised wider-frame simulations,
the eight/nine-cell formats, runtime initialization and worker delivery.

Browser tests cover continued screen updates during real geometry work, queued
requests, worker failure/recovery, preparation on slow connections, cached
refreshes and preservation of photo evidence and human confirmation. The opening
photo fixture fixes browser time explicitly so its historical session does not
expire against the real date.

## Practical limits

One to two seconds is a target for clear, sufficiently detailed images with the
reader prepared. A distant or blurred photograph may not contain enough pixels
to distinguish every stroke; glare can require additional checks. Do not guess
or shorten the number to meet a timer. Ask for a closer photo with all digits and
the decimal visible when verification fails.

Processing stays on the user's device. This change adds no database inference,
paid OCR service, model-cache version change, or accounting-data migration.
