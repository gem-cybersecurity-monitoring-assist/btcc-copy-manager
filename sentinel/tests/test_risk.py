from models import AccountState, Signal, TradeRecord, TraderSnapshot
from risk import approve_signal, classify_trader


def test_rejects_100x_plus():
    t = TraderSnapshot(name="x", recent_trades=[TradeRecord(symbol="ETH", direction="LONG", leverage=115, margin_usdt=10, pnl_usdt=1, pnl_ratio_pct=10)])
    verdict, _, reasons = classify_trader(t, 55)
    assert verdict.value == "REJECT"
    assert any("115x" in r for r in reasons)


def test_rejects_catastrophic_loss():
    t = TraderSnapshot(name="x", recent_trades=[TradeRecord(symbol="JUP", direction="SHORT", leverage=15, margin_usdt=10, pnl_usdt=-6, pnl_ratio_pct=-59)])
    verdict, _, _ = classify_trader(t, 55)
    assert verdict.value == "REJECT"


def test_rejects_capital_incompatible():
    t = TraderSnapshot(name="x", executable_min_margin_usdt=80, recent_trades=[TradeRecord(symbol="BTC", direction="LONG", leverage=10, margin_usdt=80, pnl_usdt=2, pnl_ratio_pct=2.5)])
    verdict, _, _ = classify_trader(t, 55)
    assert verdict.value == "REJECT"


def test_signal_gate():
    a = AccountState(total_usdt=55, futures_free_usdt=20, wallet_usdt=35, open_margin_usdt=0)
    s = Signal(source="test", symbol="BTCUSDT", direction="LONG", confidence=.8, entry=80000, stop=79600, target=80800, proposed_margin_usdt=10, leverage=10)
    d = approve_signal(s, a)
    assert d.allowed is True
