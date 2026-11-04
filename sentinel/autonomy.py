from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from models import AccountState, TraderSnapshot
from monitor import TraderMonitor
from risk import RiskPolicy


@dataclass(frozen=True)
class AutonomyPolicy:
    """Hard limits for autonomous copy selection and capital planning."""
    reserve_ratio: float = 0.50
    max_total_copy_ratio: float = 0.20
    max_per_trader_ratio: float = 0.05
    max_traders: int = 3
    max_snapshot_age_seconds: int = 180
    min_provenance_confidence: float = 0.95
    min_trades: int = 10
    min_score: int = 82
    max_trader_leverage: float = 10.0
    execution_leverage: int = 3
    max_daily_loss_ratio: float = 0.03
    min_allocation_usdt: float = 50.0


def _fresh(timestamp: datetime, now: datetime, max_age: int) -> bool:
    age = (now - timestamp).total_seconds()
    return 0 <= age <= max_age


def build_copy_plan(
    traders: list[TraderSnapshot],
    account: AccountState,
    policy: AutonomyPolicy = AutonomyPolicy(),
    now: datetime | None = None,
) -> dict[str, Any]:
    """Create a conservative plan. This function never calls an exchange."""
    now = now or datetime.now(timezone.utc)
    equity = max(0.0, account.total_usdt)
    reserve = equity * policy.reserve_ratio
    exposure_cap = min(equity * policy.max_total_copy_ratio, max(0.0, equity - reserve))
    daily_loss_limit = equity * policy.max_daily_loss_ratio
    daily_loss = max(0.0, -account.realized_pnl_today_usdt)
    rank_policy = RiskPolicy(
        max_margin_per_trade_usdt=policy.min_allocation_usdt,
        max_total_open_margin_usdt=exposure_cap,
        max_daily_loss_usdt=daily_loss_limit,
    )
    ranked = TraderMonitor(rank_policy).rank(traders, account)
    by_key = {(t.trader_id or t.name): t for t in traders}
    eligible: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []

    circuit_reasons: list[str] = []
    if not _fresh(account.source_timestamp, now, policy.max_snapshot_age_seconds):
        circuit_reasons.append("Account snapshot is stale or future-dated.")
    if account.provenance and account.provenance.confidence < policy.min_provenance_confidence:
        circuit_reasons.append("Account data provenance confidence is below policy.")
    if daily_loss >= daily_loss_limit and daily_loss_limit > 0:
        circuit_reasons.append("Daily realized-loss circuit breaker is active.")

    for row in ranked:
        key = row["trader_id"] or row["trader"]
        trader = by_key[key]
        reasons: list[str] = []
        if row["verdict"] != "COPY" or row["score"] < policy.min_score:
            reasons.append("Deterministic trader rating is below the autonomous-copy threshold.")
        if len(trader.recent_trades) < policy.min_trades:
            reasons.append(f"Insufficient trade history: need {policy.min_trades} recent trades.")
        if not _fresh(trader.source_timestamp, now, policy.max_snapshot_age_seconds):
            reasons.append("Trader snapshot is stale or future-dated.")
        if trader.provenance and trader.provenance.confidence < policy.min_provenance_confidence:
            reasons.append("Trader data provenance confidence is below policy.")
        if max((t.leverage for t in trader.recent_trades), default=0) > policy.max_trader_leverage:
            reasons.append(f"Observed leverage exceeds {policy.max_trader_leverage:g}x autonomous limit.")
        if trader.executable_min_margin_usdt is None:
            reasons.append("Exchange minimum executable margin is unknown.")
        if trader.exchange == "bitget" and not trader.exchange_project_id:
            reasons.append("Bitget native copy project ID is missing; trader identity cannot be mapped safely.")
        reasons.extend(circuit_reasons)
        if reasons:
            excluded.append({"trader": trader.name, "trader_id": trader.trader_id, "reasons": reasons})
        else:
            eligible.append({"trader": trader, "rank": row})

    remaining = min(exposure_cap, max(0.0, account.futures_free_usdt))
    allocations: list[dict[str, Any]] = []
    for candidate in eligible[:policy.max_traders]:
        trader = candidate["trader"]
        minimum = float(trader.executable_min_margin_usdt or 0)
        amount = min(equity * policy.max_per_trader_ratio, remaining)
        if amount < minimum or amount < policy.min_allocation_usdt:
            excluded.append({
                "trader": trader.name,
                "trader_id": trader.trader_id,
                "reasons": ["Available bounded allocation is below the exchange minimum."],
            })
            continue
        allocations.append({
            "trader": trader.name,
            "trader_id": trader.trader_id,
            "exchange": trader.exchange,
            "exchange_project_id": trader.exchange_project_id,
            "score": candidate["rank"]["score"],
            "allocation_usdt": round(amount, 2),
            "margin_per_order_usdt": round(min(amount * 0.10, 5.0), 2),
            "max_leverage": policy.execution_leverage,
            "max_position_value_usdt": round(amount * policy.execution_leverage, 2),
            "copy_existing_positions": False,
            "auto_follow_new_pairs": False,
            "status": "PLAN_ONLY",
        })
        remaining -= amount

    return {
        "status": "PLAN_ONLY",
        "generated_at": now.isoformat(),
        "account": {
            "equity_usdt": round(equity, 2),
            "reserve_usdt": round(reserve, 2),
            "copy_exposure_cap_usdt": round(exposure_cap, 2),
            "futures_free_usdt": round(account.futures_free_usdt, 2),
            "daily_loss_usdt": round(daily_loss, 2),
            "daily_loss_limit_usdt": round(daily_loss_limit, 2),
        },
        "selected": allocations,
        "excluded": excluded,
        "maintenance_policy": {
            "re_evaluate_every_seconds": 60,
            "pause_new_allocations_on_stale_data": True,
            "review_on_drawdown_or_leverage_breach": True,
            "withdrawals_enabled": False,
            "transfers_enabled": False,
        },
        "execution_blockers": [
            "Plan generation is not exchange execution.",
            "BTCC native copy follow/unfollow API is not verified.",
            "Bitget adapter is implemented, but live actions remain disabled pending credentials, allowlist and end-to-end contract verification.",
            "Live autonomy remains disabled until exchange reconciliation, idempotency, kill-switch and account policy are tested.",
        ],
    }
