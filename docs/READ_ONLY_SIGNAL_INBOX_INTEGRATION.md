# Read-only Crypto Signal Bot → GEM Copy Center integration

Status: implementation contract and source audit. This document does not enable execution, exchange access, or automated allocation.

## Verified source systems

### Crypto Signal Bot

The production Worker is Cloudflare Workers + D1, with the entry point configured in `wrangler.toml` as `worker/src/index_agent_context.ts`. The production release is intentionally paper/testnet-only:

- `TRADING_MODE=paper`, `EXCHANGE_MODE=paper`, `NETWORK=testnet`
- `ALLOW_MAINNET=false`
- `/intent/live`, `/live/order`, and `/withdraw` remain disabled
- authenticated paper actions are separately protected by the Worker's identity and GLOBAL TRADER authorization checks

The canonical Worker origin recorded by the Crypto Signal Bot production runbook and deployment status is `https://crypto-signal-bot-api.analyzer-d94.workers.dev`. Do not substitute older `workers.dev` hostnames or infer a hostname from the Worker name alone.

The current Worker exposes read-only signal routes:

- `GET /signal/latest?symbol=BTCUSDT`
- `GET /signal/history?symbol=BTCUSDT&limit=50`

The latest route reads the newest D1 `signals` row when one exists. If there is no row, it derives a `worker_ema_crossover` signal from recent `market_snapshots`. That derived response includes `price_source`, `confidence`, and `ts`. The persisted-row response includes `created_at`, but does not include the same price-source metadata. The route can return a static price fallback when external feeds and cache are unavailable, so `available: true` alone is not proof of fresh market data.

There is no dedicated signed outbound webhook or push-event route in the verified production Worker contract. The management API is not a signal-event API.

### GEM Copy Center

The production Copy Center is a planning, intelligence, and record-keeping workspace. Its current contract explicitly excludes exchange trading, copy enrollment, and automatic mirroring. Provider statistics are manually entered/imported or simulated; the existing provider registry does not yet have a verified live signal feed.


## Exact production endpoint behaviour verified in source

The read-only routes are currently protected by the Worker's global per-IP D1 rate limiter, but they do not call `requireApiKey`. That API-key check is applied to selected mutation/order routes. The read-only signal endpoints therefore must be treated as publicly reachable data endpoints, not as authenticated account data. Copy Center must not send a backend API key, exchange credential, or user token to them. The global rate limiter defaults to 120 requests per minute per IP (configurable by `RATE_LIMIT_RPM`). CORS defaults to wildcard when `CORS_ALLOWED_ORIGINS` is not configured.

Additional source details:

- `GET /market/prices?symbols=BTC,ETH` returns each resolved price with `source`, `stale`, and a response-time `ts`. This is the strongest current endpoint for identifying a cache/static fallback, but its `ts` is not the original market tick timestamp.
- `GET /market/snapshots?symbol=BTC&limit=50` returns stored snapshot rows, including `created_at`, `source`, and `stale`. It can help establish the age of the latest cached market observation.
- `GET /signal/latest` returns a persisted row directly when present; that response adds runtime safety flags and response-time `ts`, but does not add `price_source` or a linked market-snapshot ID. Otherwise it derives an EMA-style result from up to 20 stored prices and returns `price_source`; the implementation does not expose the selected snapshot IDs/timestamps or `px.stale` in that derived response.
- The current symbol normalizer removes USD/USDT suffixes but is not itself a strict symbol allowlist. Copy Center must apply its own allowlist before requesting upstream data.

Consequently, do not infer signal freshness from the response `ts`, and do not infer that a persisted signal's entry price matches the latest market price. A Copy Center preview can display source metadata as an informational observation, but must keep any signal without a trustworthy signal timestamp and linked market-data timestamp in a non-actionable `REVIEW_REQUIRED` state.

## Live read-only production smoke check (2026-10-31)

The canonical Worker origin was fetched successfully through its public GET endpoints. The observed results are a point-in-time diagnostic, not a trading recommendation:

- `GET /signal/latest?symbol=BTC` returned `HOLD`, confidence `0.5`, strategy `worker_ema_crossover`, `price_source=coinbase`, and the full paper/testnet safety flags (`allow_mainnet=false`, `live_trading_enabled=false`, `withdrawals_enabled=false`). No stop-loss or take-profit was supplied for this HOLD result.
- `GET /market/prices?symbols=BTC,ETH` returned both assets with `source=coinbase` and `stale=false` at the time of the check.
- `GET /market/snapshots?symbol=BTC&limit=3` returned stored Coinbase observations with database `created_at` timestamps.
- `GET /exchange/status` returned `status=paper_only` and `live_execution=false`.
- An unsupported symbol probe, `GET /signal/latest?symbol=UNLISTED`, still returned `available=true` with `price_source=fallback` and a synthetic price of `1`. This confirms that Copy Center must reject unknown symbols itself and must reject every `price_source=fallback` result; the Worker response's `available` field is not a validity check.

All probes were GET-only. No credentials were sent, and no order, paper trade, configuration change, database write initiated by the integration, or deployment was performed. The endpoint was reachable and the returned runtime flags remained paper/testnet-only during this check.

## Integration boundary

Implement this in stages, keeping the two applications separate:

1. **Read-only preview first.** Add a server-side Copy Center route that calls only the fixed Crypto Signal Bot Worker origin and allowlisted read-only signal paths. Do not accept a caller-supplied upstream URL.
2. **Validate and normalize.** Allow only known symbols and `BUY | SELL | HOLD`; require finite confidence and price values; retain source strategy, source timestamp, stop/take-profit values, and raw provenance fields. Reject malformed payloads.
3. **Expose provenance honestly.** Distinguish:
   - `PERSISTED_SIGNAL`: a D1 signal row with its original `created_at`
   - `DERIVED_WORKER_SIGNAL`: EMA-derived from market snapshots
   - `UNTRUSTED_PRICE_FALLBACK`: static fallback or unknown source; display as unavailable for decision-making
4. **No false freshness.** A Worker response `ts` is response time, not necessarily market-data time. Do not use it as a freshness guarantee. Persisted rows must be aged using `created_at`. Derived signals must remain `REVIEW_REQUIRED` until the Worker exposes the source snapshot timestamp and staleness.
5. **Human review only.** Show items in a dedicated Signal Inbox. Never silently add them to strategy history, mark them `official_api` verified, change provider status, alter an allocation, or submit an order.
6. **Audit and deduplicate.** Use a stable event identity (to be added by the Worker) and record when the user accepts, dismisses, or annotates an item. Repeated polling must not create duplicate audit events.
7. **Future event push.** Only after the read-only preview is validated, add a versioned Worker event contract with authenticated/signature-verified delivery, bounded expiry, replay protection, and explicit source timestamps. Keep it separate from paper-order and management endpoints.

## Implemented in the Copy Center integration branch

The first read-only vertical slice is now present on `integration/read-only-signal-inbox-contract`:

- `GET /api/signals?symbol=BTC` calls one fixed production Worker origin and one allowlisted read-only endpoint. The caller cannot supply an upstream URL, host, path, or credential.
- The route normalizes the response and returns `Cache-Control: no-store`; it does not persist the payload.
- Symbols are allowlisted to BTC, ETH, SOL, BNB, ADA, XRP, DOT, AVAX, DOGE, and LINK.
- The normalizer validates paper/testnet safety flags, side, confidence, positive entry price, risk levels, and timestamps.
- Static and cached price fallbacks are rejected for derived EMA signals.
- Persisted signals older than 15 minutes are marked stale. Derived EMA signals are marked source-time-unverified because the current Worker omits the market-snapshot timestamp.
- The new Signal Inbox tab lets the user select a symbol and refresh manually. It shows provenance, confidence, risk levels, freshness limitations, and explicit read-only/review-required labels.
- Signals are not added to the workspace, strategy records, audit history, or allocation planner. No action or order endpoint is called.

Automated tests were added for valid persisted signals, stale signals, derived-signal timestamp limitations, fallback-price rejection, paper-only flags, malformed fields, and invalid/future timestamps. The GitHub Actions CI run for the latest branch commit must pass before this slice is considered validated. Vercel deployment checks remain separately blocked by the connected account's private-organisation/Hobby-plan restriction; no production deployment has been made.

## Required Worker contract improvements before decision-grade ingestion

The Worker should return a versioned response with:

- `event_id` (stable and unique)
- `schema_version`
- `symbol`, `timeframe`, `side`
- `confidence`
- `strategy`
- `entry_price`, `stop_loss`, `take_profit`
- `source_kind` (`persisted` or `derived`)
- `price_source`
- `market_data_as_of` and `signal_created_at`
- `stale` plus an explicit `expires_at`
- paper/testnet safety flags

The Worker must not emit a decision-grade signal when the only available price is a static fallback. Do not expose account balances, user identities, access tokens, or exchange credentials in this contract.

## Copy Center UI acceptance criteria

- Add a mobile-friendly **Signal Inbox** section with clear loading, empty, stale, rejected, and available states.
- Display symbol, direction, confidence, strategy, source, source time, expiry, and risk levels.
- Label all current records as read-only and distinguish persisted from derived signals.
- Explain when a signal is stale, incomplete, or based on a fallback price.
- Require the user to open/review an item before any optional annotation or strategy-import action.
- No trade, copy activation, pause, wallet signature, or exchange credential flow is introduced.

## Test gates

- Unit tests for schema validation, symbol/side allowlists, non-finite values, timestamp parsing, expiry, fallback rejection, and deduplication.
- API tests proving the server route cannot be redirected to arbitrary hosts and never forwards user credentials or Worker operator secrets.
- UI tests for mobile layout and every loading/empty/stale/error state.
- Regression tests proving existing allocation, risk, paper-portfolio, and provider-state calculations are unchanged.
- Keep the existing Copy Center `pnpm check` gates green.
- Verify the production Worker still reports paper/testnet and its live/withdrawal routes remain blocked.

## Source references

- Crypto Signal Bot Worker entry point: `worker/src/index_agent_context.ts`
- Signal route implementation: `worker/src/index.ts` (`/signal/latest`, `/signal/history`)
- Worker safety/authentication: `worker/src/index_with_d1.ts`, `worker/src/management.ts`
- Copy Center product boundary: `README.md`, `docs/INTELLIGENCE_ENGINE.md`
- Copy Center engine types and validation: `lib/engine/types.ts`, `lib/engine/state.ts`
