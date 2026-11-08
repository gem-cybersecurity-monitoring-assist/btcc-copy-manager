# Sentinel observation persistence

`sentinel/observation_repository.py` adds a deliberately narrow server-side repository for the existing `gem_copy_account_snapshots` schema. It is not an EventStore replacement, worker, approval service, execution adapter or deployed ingestion endpoint. Nothing automatically instantiates it. No production provider credential or hosted write was used during implementation.

## Write boundary

Every save validates the supplied owner access token through the configured Supabase Auth `/auth/v1/user` endpoint. It requires the configured owner UUID, a confirmed email and a non-anonymous account. User metadata and locally decoded JWT claims do not grant access. The existing connection must then be visible through that owner's JWT/RLS, match the observation venue and have READ_ONLY or VERIFIED status. The repository never creates a connection or accepts a caller-supplied owner ID.

Only after those checks does the server credential insert the typed observation. Explicit fields exclude credentials, arbitrary provider payloads, wallet secrets, external URLs and approval state. Writes use the existing unique `(user_id, connection_id, snapshot_hash)` key with ignore-duplicates, never merge-duplicates. Duplicate retries retrieve and verify the original row using the owner JWT; mismatched returned fields fail closed. Reconstructing the repository after a restart retains idempotency through the database constraint. An ambiguous write outage reports failure without automatic retry; a later verified retry uses the same content-derived identity.

The default HTTP transport uses TLS, a 15-second timeout, a 64 KiB response cap, no redirects and sanitized failures. It never reflects upstream error bodies. Public and server keys are separate; configuration repr hides both. Server-role credentials remain privileged database credentials and must be supplied only through approved server secret storage.

## Evidence fidelity

Financial values use exact Decimal strings, reject binary floats, NaN, infinity, negative balances, excess precision and numeric overflow, and match the existing numeric(28,8) database type without rounding. Unknown availability and PnL remain null. Equity and an explicit source/currency are required. Naive timestamps, records older than the configured freshness window and observations over 60 seconds in the future are rejected.

The Bitget mapping consumes the existing read-only `BitgetAccountEvidence` DTO. It uses USDT equity and USDT availability plus the provider's account-assets timestamp. It does not relabel aggregate USD metrics, fill PnL, funding or unknown values as reconciled USDT performance. A missing provider timestamp is rejected rather than replaced with local receipt time. This mapping does not perform any exchange request.

## Explicit configuration and activation prerequisites

The optional factory reads only `SENTINEL_LEDGER_SUPABASE_URL`, `SENTINEL_LEDGER_PUBLIC_KEY`, `SENTINEL_LEDGER_SERVICE_ROLE_KEY` and `COPY_CENTER_OWNER_USER_ID`. Missing values return no configured repository. It never falls back to the legacy application's database variables. Only an exact HTTPS Supabase project origin is accepted.

Before activation: finish the approved dedicated-project owner registration and hosted tenant acceptance; verify the new UUID and an existing authorized connection; provision a server credential through approved secret storage; integrate the trusted read-only collector with explicit error handling; verify actual owner-scoped writes and dashboard reads; choose bounded durable scheduling and session/delegation handling. Do not use possession of a server key as a substitute for owner authorization. No credentials were added for this change. No new web endpoint or scheduler was exposed. Financial execution remains blocked by the existing web safeguards.

## Verification — 8 November 2026

- 57 focused repository tests passed: ordinary/unconfirmed/anonymous rejection, per-write Auth checks, cross-owner/venue/status denial, restart retry identity, write outages without retry, exact decimals, timezone normalization, stale/future data, response verification, missing configuration, upstream-error redaction, redirect rejection and Bitget fidelity.
- Full Sentinel suite: 143 tests passed after the final change.
- `bash scripts/test-sentinel-ledger.sh`: real disposable PostgreSQL schema application twice, two-owner RLS, anonymous/client-write denial, audit immutability, foreign keys, deduplication, approval and numeric constraints passed. This workflow now also runs for observation-repository changes.
- Hosted owner JWTs, service-role writes, exchange access and 24/7 operations remain untested. Local fixtures and a disposable database do not establish production acceptance.
