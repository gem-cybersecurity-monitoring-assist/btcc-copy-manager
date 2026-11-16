# GEM risk-adjusted performance engine — implementation contract

Status: specification only. No live trading, transfer, withdrawal, or claimed return.

## Objective
Maximize **measured net portfolio return subject to a user-approved loss budget**. Never optimize win rate or advertised trader ROI alone. Daily ROI is an observed metric, not a promised target.

## Decision pipeline
1. Ingest exchange-authenticated account balances, positions, fills and funding fees, plus public trader performance with timestamps and provenance.
2. Verify trader identity and native copy project IDs. Unmapped IDs are never executable.
3. Normalize trader history across venues, currencies, lookback periods, and fee assumptions. Missing evidence lowers confidence and blocks autonomous selection.
4. Assess liquidity: bid-ask spread, depth at expected order size, volume, slippage, volatility, funding rates, open interest and liquidation proximity. Stale feeds block new allocations.
5. Assess economic regime: scheduled major macro announcements, risk-on/risk-off indicators, and crypto-specific market stress. Events are context, not deterministic price predictions.
6. Produce separate independent opinions: trader-quality scout, market/liquidity reviewer, portfolio concentration reviewer, and deterministic risk gate. AI may veto or request review but cannot override hard limits.
7. Simulate portfolio allocation with exchange minimums, reserve, leverage, exposure and loss budgets. Require net expected edge after fees and realistic slippage; otherwise do not copy.
8. Paper-execute and reconcile every event against exchange snapshots. Record decisions, skipped opportunities, orders, fills, costs, and exceptions.
9. Continuously monitor risk and stop conditions; fail closed on stale data, authorization gaps, unknown execution state or provider outage. Never blindly retry a financial action.
10. Compare performance against passive copy and no-trade baselines before any live rollout.

## Required measured dashboard fields
- Daily net ROI = (end equity - start equity - net external flows) / start equity, with an appropriate time-weighted method when intraday flows occur.
- Realized and unrealized PnL separately; trading fees, funding, slippage and exchange costs.
- Maximum drawdown; daily and rolling loss; volatility; exposure; leverage; concentration; liquidity risk.
- Trader cohort, selection rationale, rejected candidates and data freshness.
- Execution success, reconciliation gaps, stop-loss slippage, latency, API availability and kill-switch state.
- Paper vs live labeling; data provenance; confidence; full audit log.

## Non-negotiable controls
- Preserve existing default reserve 50%, max total copy allocation 20%, max per-trader 5%, max three traders, 3x execution leverage and default-off live switches until explicitly reviewed.
- Per-position stops do not guarantee execution price. Include slippage and liquidation risk.
- User approval required before enabling live credentials, funded following, transfers, withdrawals or material risk-limit increases.
- Never claim 5%, 10%, or any daily return is reliable without a verified out-of-sample track record.
- Exchange capabilities must be independently verified; BTCC native copy follow/unfollow remains unverified.
- Keep Crypto Signal Bot's Supabase project isolated. Do not repurpose it.
- Do not start background jobs or paid hosting without confirmed infrastructure and authorization.

## Delivery gates
A. Unit tests for ROI accounting, drawdown, stale data, contradictory analyst opinions, fee/slippage sensitivity and risk rejection.
B. Historical walk-forward tests with survivorship-bias controls and withheld time windows.
C. Paper mode across varied volatility regimes; compare net ROI and max drawdown against simple copy baseline.
D. Verified server persistence, scheduler reliability, reconciliation, secrets handling and emergency stop.
E. Separate explicit approval for any limited live rollout.

## Existing code review observations (main branch, 2026-11)
- `sentinel/risk.py` currently scores recent trade statistics, not a fully independent liquidity or macro review.
- `sentinel/autonomy.py` is PLAN_ONLY and currently defaults to 50% reserve / 20% exposure cap / 5% per trader.
- `sentinel/models.py` on main has no max_drawdown_pct field; discovery PR #37 should be reviewed and tested before merging.
- Do not describe this specification as implemented runtime functionality.
