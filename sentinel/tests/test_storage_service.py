from pathlib import Path

from models import AccountState, CollectorBatch, TradeRecord, TraderSnapshot
from service import SentinelService
from storage import EventStore


def make_batch():
    return CollectorBatch(
        account=AccountState(total_usdt=55, futures_free_usdt=20, wallet_usdt=35, open_margin_usdt=0),
        traders=[
            TraderSnapshot(
                name="boring_good",
                trader_id="t1",
                win_rate_pct=55,
                executable_min_margin_usdt=10,
                recent_trades=[
                    TradeRecord(symbol="ETHUSDT", direction="LONG", leverage=20, margin_usdt=10, pnl_usdt=2, pnl_ratio_pct=20),
                    TradeRecord(symbol="BTCUSDT", direction="SHORT", leverage=15, margin_usdt=10, pnl_usdt=-0.8, pnl_ratio_pct=-8),
                    TradeRecord(symbol="SOLUSDT", direction="LONG", leverage=10, margin_usdt=10, pnl_usdt=1.4, pnl_ratio_pct=14),
                ],
            ),
            TraderSnapshot(
                name="wild",
                trader_id="t2",
                recent_trades=[TradeRecord(symbol="ETHUSDT", direction="LONG", leverage=125, margin_usdt=10, pnl_usdt=3, pnl_ratio_pct=30)],
            ),
        ],
    )


def test_batch_is_deduplicated(tmp_path: Path):
    store = EventStore(tmp_path / "sentinel.db")
    batch = make_batch()
    assert store.save_batch(batch) is True
    assert store.save_batch(batch) is False
    assert store.latest_account().total_usdt == 55


def test_service_emits_opportunity_and_risk_alerts(tmp_path: Path):
    store = EventStore(tmp_path / "sentinel.db")
    service = SentinelService(store)
    result = service.ingest(make_batch())
    assert result["stored"] is True
    by_name = {r["trader"]: r for r in result["ranked"]}
    assert by_name["wild"]["verdict"] == "REJECT"
    assert by_name["boring_good"]["verdict"] in {"COPY", "SMALL_TEST"}
    kinds = {a["kind"] for a in store.recent_alerts()}
    assert "trader_opportunity" in kinds
    assert "trader_risk" in kinds


def test_service_prepares_copy_action(tmp_path: Path):
    store = EventStore(tmp_path / "sentinel.db")
    service = SentinelService(store)
    result = service.ingest(make_batch())
    assert result["prepared_action_ids"]
    assert any(a["action_type"] == "COPY_CONFIGURE" for a in store.list_actions())
