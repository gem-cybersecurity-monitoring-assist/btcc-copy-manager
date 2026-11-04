# GEM Autonomous Copy Manager

## Chosen architecture

Extend this repository rather than fork a second trading application.

- GEM BTCC Manager remains the exchange/account boundary and existing live futures connector.
- BTCC Sentinel remains the collector, durable observation store, alert engine and scheduled monitor.
- The new deterministic autonomy policy engine in sentinel/autonomy.py ranks traders and creates bounded capital-allocation plans.
- A future LLM reasoning layer may summarize evidence, compare strategies and explain proposed changes. It cannot override deterministic eligibility, capital or execution gates.
- Exchange adapters remain separate per venue. Bitget is the first native copy-trading adapter candidate because its current official API documents follower subscription, settings, unfollow, current-copy, positions, close-all and copy-account transfer endpoints. BTCC native copy follow/unfollow remains UI-only until BTCC publishes or confirms a supported API.

## Decision loop

1. Ingest account and trader observations with provenance and capture timestamps.
2. Reject stale, future-dated or low-confidence snapshots.
3. Rank traders using the existing deterministic monitor.
4. Apply hard gates: minimum history, score, maximum observed leverage, known exchange minimum, account freshness and daily-loss circuit breaker.
5. Allocate only from currently available futures balance; keep a 50% account reserve and cap total copy exposure at 20% of equity, with 5% maximum per trader and no more than three traders by default.
6. Emit a plan with per-trader allocation, leverage ceiling and safe copy settings.
7. Re-evaluate every minute. Flag deteriorating traders for stop/replacement review; only call venue-specific stop/close endpoints after the adapter is implemented, tested and reconciled against exchange state.

## Current implementation status

The first deterministic planning engine is implemented with unit tests. It deliberately returns PLAN_ONLY; it does not place orders, subscribe/unsubscribe traders, transfer funds or withdraw assets.

### Why Bitget first

Bitget's official documentation currently describes authenticated futures-copy follower operations, including subscription creation/settings, unfollow, copy-account balances/positions, close-all and copy-account transfer. These APIs make a real native-copy adapter technically plausible. Adapter implementation still needs exact account product eligibility, request signing, permission scopes, idempotency strategy and integration tests.

BTCC remains connected for existing account observations and futures execution. Public BTCC material confirms its native copy product, but the currently verified BTCC TradeOpenAPI surface in this repository does not include a documented follow/unfollow API. We will not automate private UI controls as a substitute for a supported API.

## Autonomy and safety boundary

- Bounded trading/copy decisions can become autonomous after exchange adapters pass contract tests and the owner enables a specific policy.
- The LLM is advisory reasoning support, never the final risk authority.
- Stale data, missing provenance, unknown minimums, exceeded drawdown limits or uncertain exchange state stop new allocations.
- All actions require durable idempotency keys, exchange reconciliation, event audit, rate-limit handling and a global kill switch.
- Transfers are disabled in this first stage. Withdrawals and address changes remain forbidden to the agent.
- No system can promise profit. Backtest, paper and small controlled live validation are required before increasing limits.

## Test

Run the Sentinel Python test suite with pytest from the sentinel directory.
