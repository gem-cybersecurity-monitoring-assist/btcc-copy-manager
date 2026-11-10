# BTCC read-only account view

BTCC suspended its futures API on 13 February 2026, pending a restoration announcement (https://www.btcc.com/en-US/detail/176811). No restoration has been verified. The Copy Center therefore shows BTCC from two read-only sources, each clearly labelled. Neither is ever replaced by demo data.

## 1. API adapter (`lib/btcc-read-adapter.ts`)

- **Page loads** (`GET /api/connections/btcc`, owner only) make no network call. They report `provider_unavailable` with the suspension reason, and list any missing server variable names.
- **"Check BTCC API now"** (`POST /api/connections/btcc/check`, owner only) checks BTCC live. It runs only when `BTCC_API_BASE_URL` (https), `BTCC_API_KEY`, `BTCC_SECRET_KEY`, `BTCC_USERNAME` and `BTCC_PASSWORD` are set in the server environment.
  - It makes exactly two calls: the session login (`POST /v1/user/login`, which BTCC's documented API requires) and the position list (`GET /v1/account/positionlist`).
  - Any other call is refused before a network request is made.
  - A rejection, a timeout or an unknown response is reported as `provider_unavailable` with the reason. BTCC's message is sanitized and credentials are never echoed.
- BTCC's documented API exposes positions only. Balances and copy history are never invented; they come from imports.
- The adapter does not import the order-placing code in `src/lib/btcc-live.ts`; it reuses only the signature function.
- BTCC credentials are never collected in the browser.

## 2. Owner CSV import (`lib/btcc-csv.ts`, `lib/btcc-connection.ts`)

**Routes** (owner only, same-origin):
- `POST /api/connections/btcc/import` with `{ kind, fileName, csv }`, where `kind` is `balances`, `positions` or `copy_history`.
- `DELETE /api/connections/btcc/import?kind=…` removes one imported section.

**Parsing rules:**
- Recognised column names (case and punctuation ignored):
  - **Balances:** coin/asset/currency; total/balance/equity; optional available, frozen/locked, USD/USDT value.
  - **Positions:** symbol/contract/pair; side/direction; size/volume/quantity; optional entry/open price, mark price, leverage, unrealized PnL, margin.
  - **Copy history:** symbol; realized PnL/profit; an open or close time; optional trader, side, size, open/close price, fee.
- Imports are strict. Unrecognised headers or any invalid required value reject the whole file, with up to ten row errors shown.
- Missing optional values stay *Unknown*, never 0.
- Limits are 512 KB and 500/500/1000 rows.
- Leading `=`/`+`/`@` is stripped from text, so formula-like values are neutralised.

**Storage:**
- Imports are stored on a `gem_copy_connections` row with venue `btcc`, `external_account_ref` `owner-csv-import` and status `DISCONNECTED`, because there is no live BTCC link. Server storage (`SUPABASE_SERVICE_ROLE_KEY`) must be configured.
- Every section is tagged `source: owner_csv_import` and labelled **"owner-imported, not live"** in the API and the UI.
- A balance import where every row has a USD value also records a `manual_attestation` USD observation. The evidence panel shows it as "Manual record — not exchange verified".

**Browser:** the CSV is read in memory and posted once. Nothing is written to browser storage.
