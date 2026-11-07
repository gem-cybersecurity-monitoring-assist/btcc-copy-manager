# GEM Copy Center durable Sentinel ledger (isolated backend)

This repository contains the **unapplied** migration `supabase/migrations/20261107_gem_copy_sentinel_ledger.sql`. It has not been run against any connected Supabase organization or project. Do not run it against `crypto-signal-bot`, GEM Enterprise, or a project whose existing data ownership is not verified.

## Intended architecture

The existing `copy_center_workspaces` JSON document remains the user's workspace for saved research preferences. This new isolated ledger adds six normalized, owner-scoped record types:

- Connections: venue, external account reference, status, and an **opaque Vault reference**, never raw API credentials.
- Account snapshots: source-labeled balances, exchange-reported PnL, capture time, and hash-based deduplication.
- Trader observations: segregated third-party and official-exchange IDs. `native_id_verified` requires official evidence; a Kopyon trader ID cannot silently turn into an execution ID.
- Monitor runs: durable run keys, source freshness, risk findings and reports.
- Execution actions: per-owner idempotency, proposed/approved/executed state, payload hash and approval timestamps. Only the trusted backend may mutate these rows. Database constraints are defense in depth, not a substitute for signature verification and transaction-safe execution.
- Audit events: owner-readable append-only records. No authenticated client write capability; service-role write privileges exclude update and delete on audit records.

Every table has RLS enabled, an explicit authenticated own-row SELECT policy and no anonymous grants. The service role has tightly scoped DML capabilities. **Bypass-RLS service credentials must never appear in browser code, client bundles or diagnostics.** A service role also requires a trusted server that verifies the user's JWT and maps the owner ID before any database or exchange action.

## Before applying

First verify a dedicated GEM Copy Manager Supabase destination and confirm no unrelated data will be modified. Review the SQL in the Supabase SQL editor in a controlled staging instance, execute it transactionally with migrations, then test that (1) anonymous reads fail, (2) user A cannot read user B's data, (3) authenticated sessions cannot write to protected financial tables, and (4) the backend can insert only with a verified owner context. Validate audit immutability, foreign-key enforcement, duplicate run/action keys, and credential redaction. The migration is not a production deployment or a permission to connect live trading accounts.

## Service and automation requirements

Implement the Sentinel Postgres repository adapter separately from its current SQLite development store. Require a persistent worker, encrypted Vault secrets, bounded schedules, data-age checks, idempotent atomic status transitions, per-owner approval verification, manual withdrawal-only policy and reconciliation with exchange fills/fees/funding. Do not enable a live follow, close, transfer or withdrawal action from the existence of this migration alone.

The dashboard may show source-verified observations, but it must not claim exchange-enforced stops or 24/7 autonomous execution until integration tests confirm they are functioning against the approved account.

## Executable schema acceptance (7 November 2026)

The original PR #67 SQL contained an unterminated Vault-reference constraint and a duplicated trailing schema block. It passed substring checks but failed actual PostgreSQL application. These syntax errors are corrected. Privileges are now reset for service_role as well, so permissive default grants cannot leave TRUNCATE access on the append-only audit table. Account snapshots also reject PostgreSQL numeric NaN values.

Run `bash scripts/test-sentinel-ledger.sh` from this repository. It starts a digest-pinned official PostgreSQL 16 container with no network and no published ports, creates synthetic Supabase-style roles and an auth.uid() stub, applies the migration twice, tests its constraints, and removes the disposable container on exit. No hosted database URL, credential or project is used. The same check runs in the path-scoped Sentinel ledger PostgreSQL validation workflow.

Actual local results: migration and reapplication passed; two synthetic owners saw only their own rows across all six tables; anonymous reads and authenticated insert/update/delete were denied; service audit update/delete/truncate were denied; cross-owner connection references, duplicate snapshots/run/action keys, non-Vault credentials, unapproved EXECUTED rows and NaN balances were rejected. The original SQL failed with a syntax error in the same harness. This is isolated database testing, not proof of a real owner's authenticated Supabase session or application persistence. The migration remains unapplied to all connected Supabase projects.
