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

The deterministic planning engine and a signed Bitget v3 futures-copy adapter are implemented with unit tests. The adapter supports current-copy, positions, profit details, follow, modify, unfollow and close-all. Mutations require an explicit live flag, an allowlisted project ID and a separate Sentinel control token. It exposes no transfer or withdrawal method. The decision planner still returns PLAN_ONLY until a supported trader-discovery feed and reconciled end-to-end execution loop are verified. Sentinel now also emits a maintenance review: it flags deteriorating active followers for stop/replacement review, pauses new allocations on stale observations, and lists replacement candidates. These are review decisions, not exchange side effects.

### Why Bitget first

Bitget's official documentation describes authenticated futures-copy follower operations: create subscription, modify settings, unfollow, current-copy, current positions, profit details and close-all. The documented minimum subscription amount is 50 USDT; the planner now enforces that floor. Follow settings are constrained to at most 10x leverage, auto-follow of new pairs off, a bounded position value and a fixed per-order margin. The adapter signs requests using Bitget's timestamp/method/path/body HMAC scheme, requires a project allowlist and defaults live mutations off. The owner must provision a dedicated API key with the required copy-trading read/write scopes in the Bitget account settings.

BTCC remains connected for existing account observations and futures execution. Public BTCC material confirms its native copy product, but the currently verified BTCC TradeOpenAPI surface in this repository does not include a documented follow/unfollow API. We will not automate private UI controls as a substitute for a supported API.

The verified Bitget v3 follower API is an execution/account-management surface, not a public leaderboard discovery API. Each candidate must therefore arrive with a verified Bitget projectId and evidence-backed performance snapshot. The data model now carries the exchange and exchange_project_id explicitly; the planner rejects Bitget records without that mapping. Do not substitute a display name or an unrelated trader UID for projectId.

## Autonomy and safety boundary

- Bounded trading/copy decisions can become autonomous after exchange adapters pass contract tests and the owner enables a specific policy.
- The LLM is advisory reasoning support, never the final risk authority.
- Stale data, missing provenance, unknown minimums, exceeded drawdown limits or uncertain exchange state stop new allocations.
- A durable SQLite exchange-action ledger is now included. Mutation routes require a unique idempotency key, the Sentinel control token, a project allowlist and the live flag. Replayed completed actions return the recorded result; PENDING or UNKNOWN actions are blocked until reconciled. Before autonomous execution, wire exchange-state reconciliation and the global kill switch into the scheduler. Do not retry non-idempotent follow/unfollow/close requests blindly.
- Transfers are disabled in this first stage. Withdrawals and address changes remain forbidden to the agent.
- No system can promise profit. Backtest, paper and small controlled live validation are required before increasing limits.

## Test

Run the Sentinel Python test suite with pytest from the sentinel directory. The Bitget adapter tests use a fake transport and never call the exchange.
