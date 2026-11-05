# Pump photo recognition speed

The `lcd-fast-consensus-5` reader reduces waiting while preserving the previous
reader's acceptance and confirmation rules. It does not rewrite saved readings.

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
