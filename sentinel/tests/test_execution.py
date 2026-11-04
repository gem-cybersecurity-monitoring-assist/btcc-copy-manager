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


class FakeStore:
    def __init__(self):
        self.active = {}
        self.actions = {}
    def get_active_subscription(self, project_id):
        return self.active.get(project_id)
    def latest_exchange_action(self, venue, project_id):
        rows = [row for row in self.actions.values() if row["venue"] == venue and row["project_id"] == project_id]
        return rows[-1] if rows else None
    def begin_exchange_action(self, key, venue, action_type, project_id, payload):
        if key in self.actions:
            return False, self.actions[key]
        row = {"venue": venue, "action_type": action_type, "project_id": project_id,
               "status": "PENDING", "payload": payload}
        self.actions[key] = row
        return True, row
    def finish_exchange_action(self, key, status, response=None, error=None):
        self.actions[key]["status"] = status
        self.actions[key]["response"] = response
        self.actions[key]["error"] = error
        return True
    def mark_subscription_active(self, project_id, venue, trader_id, trader_name, amount_usdt, leverage, max_position_value_usdt):
        self.active[project_id] = {"project_id": project_id, "venue": venue, "amount_usdt": amount_usdt}
    def mark_subscription_inactive(self, project_id):
        self.active.pop(project_id, None)
    def list_active_subscriptions(self):
        return list(self.active.values())


class FakeAdapter:
    class Config:
        live_enabled = True
        internal_transfer_enabled = True
        copy_fund_source = "uta"
    def __init__(self):
        self.config = self.Config()
        self.follow_calls = []
        self.unfollow_calls = []
    def follow(self, *args, **kwargs):
        self.follow_calls.append((args, kwargs))
        return "success"
    def copy_settings(self, project_id):
        return {"autoCopy": "off", "leverage": "3", "type": "fixed_margin"}
    def current_copy(self, project_id):
        return {"eliteTrader": "Trader"}
    def profit_details(self, project_id):
        return {"list": []}
    def unfollow(self, project_id, close_type):
        self.unfollow_calls.append((project_id, close_type))
        return "success"
    def current_positions(self, project_id):
        return {"list": []}


def test_autonomous_follow_is_idempotent_and_reconciled(monkeypatch):
    from models import Provenance, TradeRecord, TraderSnapshot
    monkeypatch.setenv("GEM_AUTO_COPY_EXECUTION_ENABLED", "true")
    monkeypatch.setenv("GEM_AUTO_STOP_REPLACE_ENABLED", "false")
    now = datetime.now(timezone.utc)
    trader = TraderSnapshot(
        name="Leader", trader_id="leader-1", exchange="bitget",
        exchange_project_id="project-1", currently_following=False,
        recent_trades=[
            TradeRecord(symbol="BTCUSDT", direction="LONG", leverage=3, margin_usdt=5, pnl_usdt=1, pnl_ratio_pct=5),
            TradeRecord(symbol="ETHUSDT", direction="SHORT", leverage=3, margin_usdt=5, pnl_usdt=1, pnl_ratio_pct=5),
        ],
        source_timestamp=now, provenance=Provenance(source="manual", confidence=0.99),
    )
    batch_obj = CollectorBatch(
        collector_id="bitget-test", captured_at=now,
        account=AccountState(exchange="bitget", total_usdt=1000, futures_free_usdt=500, wallet_usdt=0, open_margin_usdt=0, source_timestamp=now),
        traders=[trader],
    )
    plan = {"selected": [{
        "trader": "Leader", "trader_id": "leader-1", "exchange": "bitget",
        "exchange_project_id": "project-1", "allocation_usdt": 50,
        "max_leverage": 3, "max_position_value_usdt": 150, "margin_per_order_usdt": 5,
    }]}
    store = FakeStore()
    adapter = FakeAdapter()
    executor = BitgetAutoExecutor(store, adapter)
    first = executor.execute(batch_obj, plan, {"stop_review": []})
    second = executor.execute(batch_obj, plan, {"stop_review": []})
    assert first["actions"][0]["status"] == "executed"
    assert second["actions"][0]["status"] == "already_active"
    assert len(adapter.follow_calls) == 1
    assert store.active["project-1"]["amount_usdt"] == 50


def test_autonomous_stop_closes_positions_before_marking_inactive(monkeypatch):
    monkeypatch.setenv("GEM_AUTO_COPY_EXECUTION_ENABLED", "false")
    monkeypatch.setenv("GEM_AUTO_STOP_REPLACE_ENABLED", "true")
    now = datetime.now(timezone.utc)
    store = FakeStore()
    store.active["project-1"] = {"project_id": "project-1", "venue": "bitget"}
    adapter = FakeAdapter()
    executor = BitgetAutoExecutor(store, adapter)
    batch_obj = batch("bitget")
    maintenance = {"stop_review": [{
        "exchange": "bitget", "project_id": "project-1",
        "reasons": ["Deteriorating risk metrics"],
    }]}
    result = executor.execute(batch_obj, {"selected": []}, maintenance)
    assert result["actions"][0]["status"] == "executed"
    assert adapter.unfollow_calls == [("project-1", "instant_close")]
    assert "project-1" not in store.active
