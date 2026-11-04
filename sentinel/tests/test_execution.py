from datetime import datetime, timezone

from bitget_copy import BitgetConfig, BitgetCopyAdapter
from execution import BitgetAutoExecutor
from models import AccountState, CollectorBatch


def batch(exchange="bitget"):
    now = datetime.now(timezone.utc)
    return CollectorBatch(
        collector_id="test",
        captured_at=now,
        account=AccountState(
            exchange=exchange, total_usdt=1000, futures_free_usdt=500,
            wallet_usdt=0, open_margin_usdt=0, source_timestamp=now,
        ),
        traders=[],
    )


def test_autonomous_execution_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("GEM_AUTO_COPY_EXECUTION_ENABLED", raising=False)
    monkeypatch.delenv("GEM_AUTO_STOP_REPLACE_ENABLED", raising=False)
    adapter = BitgetCopyAdapter(BitgetConfig("", "", ""))
    result = BitgetAutoExecutor(store=None, adapter=adapter).execute(batch(), {}, {})
    assert result["status"] == "disabled"
    assert result["actions"] == []


def test_autonomous_execution_requires_bitget_account_snapshot(monkeypatch):
    monkeypatch.setenv("GEM_AUTO_COPY_EXECUTION_ENABLED", "true")
    monkeypatch.setenv("GEM_AUTO_STOP_REPLACE_ENABLED", "false")
    adapter = BitgetCopyAdapter(BitgetConfig(
        "key", "secret", "pass", live_enabled=True,
        internal_transfer_enabled=True, copy_fund_source="uta",
    ))
    result = BitgetAutoExecutor(store=None, adapter=adapter).execute(batch("btcc"), {}, {})
    assert result["status"] == "blocked"
    assert "not from Bitget" in result["reason"]
