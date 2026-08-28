from __future__ import annotations

from dataclasses import dataclass

from models import AccountState, RiskDecision, Signal, TraderSnapshot, Verdict


@dataclass(frozen=True)
class RiskPolicy:
    max_trade_leverage: float = 30.0
    hard_reject_leverage: float = 100.0
    catastrophic_loss_pct: float = -50.0
    max_margin_per_trade_usdt: float = 20.0
    max_total_open_margin_usdt: float = 30.0
    max_daily_loss_usdt: float = 5.0
    max_positions: int = 2
    min_signal_confidence: float = 0.72
    stale_after_seconds: int = 180


def classify_trader(t: TraderSnapshot, available_capital_usdt: float, p: RiskPolicy = RiskPolicy()):
    reasons: list[str] = []
    trades = t.recent_trades
    if not trades:
        return Verdict.WATCH, 35, ["No recent trade history available"]

    max_lev = max(x.leverage for x in trades)
    worst = min(x.pnl_ratio_pct for x in trades)
    if max_lev >= p.hard_reject_leverage:
        reasons.append(f"Recent leverage reached {max_lev:.0f}x (hard reject >= {p.hard_reject_leverage:.0f}x)")
    if worst <= p.catastrophic_loss_pct:
        reasons.append(f"Recent trade lost {worst:.1f}% of margin (hard reject <= {p.catastrophic_loss_pct:.0f}%)")
    if t.executable_min_margin_usdt and t.executable_min_margin_usdt > min(available_capital_usdt, p.max_margin_per_trade_usdt):
        reasons.append(f"Minimum executable margin ${t.executable_min_margin_usdt:.2f} exceeds allowed small-test capital")
    if reasons:
        return Verdict.REJECT, 0, reasons

    high_lev_share = sum(x.leverage > p.max_trade_leverage for x in trades) / len(trades)
    avg_pnl = sum(x.pnl_ratio_pct for x in trades) / len(trades)
    loss_count = sum(x.pnl_usdt < 0 for x in trades)
    win_count = len(trades) - loss_count
    gross_win = sum(max(0, x.pnl_usdt) for x in trades)
    gross_loss = abs(sum(min(0, x.pnl_usdt) for x in trades))
    profit_factor = gross_win / gross_loss if gross_loss > 0 else (3.0 if gross_win > 0 else 0.0)

    score = 65
    score -= int(high_lev_share * 35)
    score += 10 if worst > -20 else -8
    score += 8 if avg_pnl > 0 else -10
    score += 7 if profit_factor >= 1.3 else (-8 if profit_factor < 1 else 0)
    score += 4 if (t.win_rate_pct or (100 * win_count / len(trades))) >= 50 else 0
    score = max(0, min(100, score))

    if score >= 82:
        verdict = Verdict.COPY
    elif score >= 70:
        verdict = Verdict.SMALL_TEST
    else:
        verdict = Verdict.WATCH
    return verdict, score, reasons or ["Passed hard filters; requires continued monitoring"]


def approve_signal(signal: Signal, account: AccountState, p: RiskPolicy = RiskPolicy()) -> RiskDecision:
    reasons: list[str] = []
    if account.realized_pnl_today_usdt <= -p.max_daily_loss_usdt:
        reasons.append("Daily loss circuit breaker active")
    if account.active_positions >= p.max_positions:
        reasons.append("Maximum simultaneous positions reached")
    if signal.leverage > p.max_trade_leverage:
        reasons.append(f"Signal leverage {signal.leverage:.0f}x exceeds policy {p.max_trade_leverage:.0f}x")
    if signal.confidence < p.min_signal_confidence:
        reasons.append("Signal confidence below execution threshold")
    remaining_open_margin = max(0.0, p.max_total_open_margin_usdt - account.open_margin_usdt)
    max_margin = min(p.max_margin_per_trade_usdt, account.futures_free_usdt, remaining_open_margin)
    if signal.proposed_margin_usdt > max_margin:
        reasons.append(f"Proposed margin ${signal.proposed_margin_usdt:.2f} exceeds current policy allowance ${max_margin:.2f}")
    if max_margin <= 0:
        reasons.append("No margin capacity available")

    price_risk = abs(signal.entry - signal.stop) / signal.entry if signal.entry else 1
    est_loss = signal.proposed_margin_usdt * signal.leverage * price_risk
    return RiskDecision(
        allowed=not reasons,
        reasons=reasons or ["All deterministic risk checks passed"],
        max_margin_usdt=max_margin,
        estimated_max_loss_usdt=round(est_loss, 4),
    )
