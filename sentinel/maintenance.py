from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from autonomy import AutonomyPolicy, build_copy_plan
from models import AccountState, TraderSnapshot
from monitor import TraderMonitor
from risk import RiskPolicy


def build_maintenance_plan(
    traders: list[TraderSnapshot],
    account: AccountState,
    policy: AutonomyPolicy = AutonomyPolicy(),
    now: datetime | None = None,
) -> dict[str, Any]:
    """Identify deterioration in currently followed traders without side effects."""
    now = now or datetime.now(timezone.utc)
    risk_policy = RiskPolicy(
        max_margin_per_trade_usdt=policy.min_allocation_usdt,
        max_total_open_margin_usdt=max(account.total_usdt * policy.max_total_copy_ratio, 0),
        max_daily_loss_usdt=account.total_usdt * policy.max_daily_loss_ratio,
    )
    ranked = TraderMonitor(risk_policy).rank(traders, account)
    by_key = {(t.trader_id or t.name): t for t in traders}
    stop_review: list[dict[str, Any]] = []
    retain: list[dict[str, Any]] = []
    for row in ranked:
        trader = by_key[row["trader_id"] or row["trader"]]
        if not trader.currently_following:
            continue
        age = (now - trader.source_timestamp).total_seconds()
        if age < 0 or age > policy.max_snapshot_age_seconds:
            retain.append({
                "exchange": trader.exchange,
                "project_id": trader.exchange_project_id,
                "trader": trader.name,
                "decision": "PAUSE_NEW_ALLOCATIONS",
                "reason": "Snapshot is stale or future-dated; do not issue a blind unfollow or close command.",
            })
            continue
        reasons = []
        if row["verdict"] == "REJECT":
            reasons.extend(row["reasons"])
        if row["score"] < 60:
            reasons.append(f"Trader score fell to {row['score']}, below the 60-point maintenance floor.")
        if (row["max_leverage"] or 0) > policy.max_trader_leverage:
            reasons.append(f"Observed leverage exceeds {policy.max_trader_leverage:g}x maintenance limit.")
        if row["worst_trade_pct"] is not None and row["worst_trade_pct"] <= -35:
            reasons.append(f"Worst recent trade reached {row['worst_trade_pct']:.1f}% of margin.")
        if reasons:
            stop_review.append({
                "exchange": trader.exchange,
                "project_id": trader.exchange_project_id,
                "trader": trader.name,
                "score": row["score"],
                "decision": "STOP_AND_REPLACE_REVIEW",
                "reasons": reasons,
                "status": "REVIEW_ONLY",
            })
        else:
            retain.append({
                "exchange": trader.exchange,
                "project_id": trader.exchange_project_id,
                "trader": trader.name,
                "decision": "RETAIN",
                "score": row["score"],
            })
    replacements = build_copy_plan(
        [t for t in traders if not t.currently_following], account, policy, now
    )
    return {
        "generated_at": now.isoformat(),
        "stop_review": stop_review,
        "retain": retain,
        "replacement_candidates": replacements["selected"],
        "status": "REVIEW_ONLY",
        "execution": "No unfollow, close, follow, transfer or withdrawal is performed.",
    }
