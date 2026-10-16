# Liloan incremental storage

The migration retains the original state in `fueltech_pilot_state_legacy`, preserves all existing transaction snapshots, and verifies exact JSON equality before completing. The `fueltech_pilot_state` compatibility view reconstructs the original representation, so existing exports, nightly backups and already-open deployments continue to work.

`storage_version=2` enables the new repository path. Reports and photos are individual documents; audit events are appended once with an ordered sequence; POS rows and points are individual documents with explicit order lists. Unchanged documents are not rewritten. Normal requests load no historical audit events; the Admin audit endpoint loads 100 at a time and returns `nextCursor` for the next request's `before` field. Compact reads use committed POS summaries. Full POS evidence is loaded for forced cash checks/submission, expired imports, status transitions and newly created shifts. Financial fields remain server-owned in both paths.

Every accepted mutation writes its document delta, appended audit events, canonical report/price changes, revision and idempotent receipt in one transaction. All canonical historical guards and per-report stale-edit checks remain enforced. The legacy RPC is adapted to the same writer for rolling deployment compatibility.

The journal and original checkpoint reconstruct any revision since migration through the read-only `fueltech_pilot_restore_revision(mode, revision)` function. It returns JSON and never changes live records. Nightly backups keep full snapshots, create a daily checkpoint and export immutable journal chunks to the independent backup project. Earlier revisions remain available in the untouched legacy transaction backups.

The browser caches only verified complete store loads in memory. Later refreshes request revisions after that snapshot. Global dependency changes return complete pages; report-only changes transfer affected reports. Server scope checks prevent cached records from being reused across roles or branches, and interrupted pages never publish a partial cache.

## Rollout and verification

1. Apply the migration transactionally; any preservation mismatch aborts it.
2. Deploy this revision to the existing Accounting project. Both old and new deployments work with the compatibility API.
3. Compare document reconstruction with the migration checkpoint and compare canonical record counts/totals. Checkpoint and restoration tests must pass before considering archival of older snapshots.
4. Check new `fueltech_pilot_commit_v2` calls, temporary writes per save, journal bytes per save, API errors, memory, swap and disk throughput under normal traffic. Compare equivalent observation windows; I/O budget and cached RAM percentages need time to reflect changed work.

No old backup, audit event, historical accounting record, photo or journal is deleted. Shrinking provisioned disk, changing memory settings and deleting retained snapshots are separate operations.
