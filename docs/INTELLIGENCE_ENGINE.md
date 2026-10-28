# GEM Copy Trading Intelligence Engine

The engine helps you compare independent copy-trading opportunities, spread small amounts of capital across them within explicit risk limits, and notice when something deteriorates. It does the research bookkeeping, calculations, comparisons, monitoring, and recordkeeping.

It does **not** move money, enroll you in copy trading, pause a trader, read exchange accounts, or place trades. Every platform action happens on the platform itself. Spreading money across providers diversifies *provider* risk only; strategies on different platforms can still carry the same market risk, and the engine treats them that way.

Code: `lib/engine/` (framework-free, unit-tested in `tests/engine.test.ts`) and the dashboard tabs in `app/copy-trading/engine/`.

## How a decision is made

1. **Research** — you record traders/strategies: profile figures (dated observations with source and confidence) and, ideally, return or equity history as CSV.
2. **Verify & score** — data-quality checks flag stale, short, inconsistent, extreme, or concentrated records; every strategy gets the same transparent score with an explanation, missing data, and what could invalidate it.
3. **Allocate** — the planner tests amounts against provider minimums, fixed costs, per-provider/strategy/cluster/asset caps, a cash reserve, and a portfolio drawdown budget, and may leave capital unallocated.
4. **Monitor** — reviews re-score strategies, recompute portfolio exposure, detect behaviour changes against each strategy's own baseline, raise/resolve alerts idempotently, record score history and an audit trail, and propose a reallocation *review* (never an automatic change).

## Providers (tab A)

| Provider | Integration | What GEM can do | What you do on the platform |
| --- | --- | --- | --- |
| BTCC | Guided native workflow | Links, activation/pause guide, user-confirmed status tracking | Sign in, select trader, set copy amount and risk options, start/stop copying |
| Bitget | Guided native workflow | Same as above. Bitget publishes API docs with copy-trading sections, but GEM has **not implemented or verified** them | Same |
| MetaTrader 5 / MQL5 Signals | Guided native workflow | Same; flags that monthly signal fees can make small allocations uneconomic | Subscribe/unsubscribe in your broker's MT5 terminal |
| Custom (user-added) | Manual | Same; can never claim a supported capability | Everything |

Capabilities are tracked per provider as `supported` (implemented and verified), `not_implemented`, or `not_available`. **No provider currently has a supported capability.**

Statuses follow `DISCOVERED → ACCOUNT LINKED → ACCOUNT VERIFIED → TRADER SELECTED → COPY ACTIVATION PENDING → COPY ACTIVE`, plus `PAUSED`, `DISCONNECTED`, `ERROR`, `NOT SUPPORTED`. Steps cannot be skipped, each user-recorded step requires a note describing what you saw, and every entry is labelled "confirmed by you, not independently verified". `DATA STALE` is derived automatically when a tracked provider's figures are older than the policy's stale threshold. Stored data cannot claim `official_api` evidence; only a real adapter could set it.

## Research sources (tab B)

| Source | Status |
| --- | --- |
| Provider APIs / live feeds | **Unavailable** — no adapter implemented |
| Official trader profiles | Manual transcription (confidence ≤ 0.7) |
| Return / equity history | CSV import, validated (dates strictly increasing, numeric, no −100% periods); confidence ≤ 0.6 |
| Market data, news, Farcaster/social | **Unavailable**. Social posts are leads to check on the official platform, never inputs to scoring |
| Simulated sample | Available for testing; labelled SIMULATED, confidence 0.2, never eligible for real allocation |

## Scoring (tab C)

Components (default weights, editable): net return 20, drawdown 25, risk-adjusted (Sortino) 15, consistency (profitable rolling windows) 10, history length 10, data quality 20. Missing components score **zero**, so thin evidence cannot rank highly.

- Net returns deduct the recorded profit share on new equity highs (high-water mark) and a cost drag of 0.02%/day or 0.1%/week for fees, funding, and slippage.
- Sharpe/Sortino/volatility are only reported with 30+ periods.
- Penalties: extreme single-period moves, gains concentrated in the 5 best periods, short-term ROI spikes, reported vs computed drawdown mismatch (−10 each). Drawdown over the policy limit caps the score at 35; leverage over the limit caps it at 40.
- Eligibility requires return history of at least the policy minimum, data confidence ≥ the minimum, fresh data, score ≥ the minimum, and drawdown/leverage/profit share within limits.

Scores are screening aids, not predictions.

## Allocation (tab D)

Inputs: total capital, reserve %, $ cap per provider, method (`equal`, `risk_adjusted` = inverse volatility, `score_weighted`), whether unknown minimums are allowed, plus the risk policy. The planner:

1. Rejects ineligible strategies and providers in `ERROR`/`DISCONNECTED`, with reasons.
2. Distributes investable capital by weight, scaling down proportionally wherever a strategy, provider, or correlated-cluster cap binds.
3. Drops candidates whose amount is below the provider minimum or whose fixed costs exceed the cost limit (weakest first; within a correlated cluster the weaker member yields), then gives size-rejected candidates a second chance.
4. Scales everything down if a simultaneous repeat of each holding's worst drawdown would exceed the portfolio limit.
5. Leaves the remainder unallocated and says why.

Example with defaults ($30, 10% reserve, $10/provider): $10 to one Bitget strategy, $10 to one BTCC strategy, a correlated duplicate rejected, an MT5 signal with a $50 minimum rejected, $7 held back.

## Risk center (tab E)

Exposure is computed across the whole portfolio (amounts you record as allocated in Providers): by provider, strategy, asset (split across a strategy's assets), and correlated cluster (return correlation ≥ threshold, or ≥50% asset overlap when no shared history). Alerts cover concentration, shared asset exposure across platforms, held strategies that fail policy, current drawdown, leverage, behaviour change (recent drawdown beyond history, volatility jump, returns significantly below baseline), stale data, provider errors, unassigned allocations, and the portfolio stress loss. Recommendations are proportionate and always state that **stopping copy may leave existing positions open**.

## Monitoring & audit (tab F)

Reviews run in the browser when the dashboard opens and the interval (default 24h) has passed, or on demand. **No background server job is deployed.** A server-side scheduler would need either a privileged database key (which this project deliberately does not use) or a per-user secret store plus a job runner (e.g. Supabase Edge Functions + `pg_cron`), and there is no provider data feed to refresh yet. The audit trail records user actions (status changes, figures, strategies, policy changes, paper portfolios) and engine events (reviews, alerts raised/resolved, backtests).

## Simulation lab (tab G)

Walk-forward backtest: after a warm-up, each rebalance uses only data dated before it (lagged by a configurable delay), applies the same scoring, policy, minimums, caps, and drawdown budget, charges a rebalance cost, and holds until the next rebalance. Equal, risk-adjusted, score-weighted, and an all-cash baseline are compared under identical assumptions. Reports include sample size, out-of-sample window, assumptions, and limitations (including survivorship bias from recording only traders you found). A test proves altering the final period cannot change any earlier result (no look-ahead).

Paper portfolios snapshot a proposal and are valued only from returns recorded after their start date. Both are labelled as simulations.

## Wallets (tab H)

Optional MetaMask (EIP-1193) and Phantom connections: public address, network, and native EVM balance only. No signatures, approvals, swaps, transfers, or deposits; nothing is stored. Wallets are not exchange accounts.

## Storage, security, and limits

Engine state is part of the per-user workspace: browser storage key `gem-copy-center-engine-v1`, JSON backups, and the RLS-protected `copy_center_workspaces.payload` (as `payload.engine`). No migration is needed. Validation is strict (one malformed record rejects the payload; https-only links; no forged verification or capabilities). Limits: 60 strategies, 400 points per history, 8,000 points total, 30 custom providers, 200 alerts, 300 audit events, 1,500 score snapshots, 20 paper portfolios; writes are also kept under the 750 KB workspace limit by trimming the oldest audit/alert/score history, or refused with a message.

Storing the engine in the workspace JSON keeps one ownership model (RLS on `user_id`) and works offline. Normalized tables (providers, observations, scores, alerts, audit) become worthwhile when a server-side job or provider adapter needs to write data; that is the documented next step together with any real integration.

## What a real integration would require

For any provider, before a capability can be marked `supported`: official documentation for the exact operation, a read-only key stored encrypted server-side per user (not in browser storage and not the Supabase anon key), an adapter implementing fetch → validate → normalize with rate limits/retries/idempotency, tests against the documented interface, and for any action (activate/pause) explicit user approval with an audit record. Do not use futures-order endpoints as a substitute for copy enrollment.
