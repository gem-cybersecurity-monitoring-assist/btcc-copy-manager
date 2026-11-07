# Owner-scoped Sentinel account snapshot read

A read-only, server-side endpoint is implemented at
`GET /api/v1/ledger/snapshots`. It returns at most 25 recent snapshots
from the **unapplied** `gem_copy_account_snapshots` table.

## Authorization and data provenance

- Requires a valid signed-in Supabase account session. The session is
  independently validated using the existing cloud auth service.
- Calls Supabase PostgREST using the **user JWT**, not a service-role key.
- Filters `user_id` from the verified session and relies on database RLS
  to enforce per-owner row isolation.
- Selects an explicit minimal set of columns; neither raw credentials nor
  unrelated snapshot metadata is returned.
- `sourceKind` distinguishes `official_api` from
  `manual_attestation`. Manual entries must never be presented as
  exchange-confirmed balances.
- Fails closed on unexpected types, invalid decimal values, network failure
  or missing ledger tables. A missing migration returns
  `503 ledger_not_ready`, rather than fabricating an empty account.
- No exchange API connection, funds transfer, automatic follow, execution
  approval, reconciliation, database mutation or schema application occurs.

## Deployment dependency

The destination GEM Copy Manager Supabase project is **not yet identified**.
Connected inventory on 2026-11-07 listed `crypto-signal-bot`, `my website`
and `infinite-world-of-wellbeing`; none has been designated for this
ledger, and this feature must not repurpose them.

After an appropriate dedicated destination is approved and established,
review and apply `supabase/migrations/20261107_gem_copy_sentinel_ledger.sql`
there under controlled migration, validate tenant isolation with actual
authenticated users, then test this endpoint against that same project.
Until then, it is a tested integration contract, **not** production balance
persistence or proof of real signed-in account access.

## Verification

- `pnpm typecheck`, `pnpm test`, `pnpm build`
- `tests/ledger-snapshot-read.test.ts` tests session rejection, JWT and
  owner filtering, provenance redaction, missing schema, network errors,
  and invalid financial evidence using a mock Supabase API.
