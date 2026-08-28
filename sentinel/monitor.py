from __future__ import annotations

from models import AccountState, TraderSnapshot
from risk import RiskPolicy, classify_trader


class TraderMonitor:
    def __init__(self, policy: RiskPolicy | None = None):
        self.policy = policy or RiskPolicy()

    def rank(self, traders: list[TraderSnapshot], account: AccountState):
        rows = []
        for t in traders:
            verdict, score, reasons = classify_trader(t, account.total_usdt, self.policy)
            trades = t.recent_trades
            gross_win = sum(max(0, x.pnl_usdt) for x in trades)
            gross_loss = abs(sum(min(0, x.pnl_usdt) for x in trades))
            profit_factor = gross_win / gross_loss if gross_loss else (None if not gross_win else float("inf"))
            rows.append({
                "trader": t.name,
                "trader_id": t.trader_id,
                "verdict": verdict.value,
                "score": score,
                "trade_count": len(trades),
                "max_leverage": max((x.leverage for x in trades), default=None),
                "worst_trade_pct": min((x.pnl_ratio_pct for x in trades), default=None),
                "profit_factor": round(profit_factor, 3) if isinstance(profit_factor, float) and profit_factor != float("inf") else profit_factor,
                "min_margin": t.executable_min_margin_usdt,
                "reasons": reasons,
                "source_timestamp": t.source_timestamp.isoformat(),
            })
        priority = {"COPY": 0, "SMALL_TEST": 1, "WATCH": 2, "REJECT": 3}
        return sorted(rows, key=lambda r: (priority[r["verdict"]], -r["score"]))
