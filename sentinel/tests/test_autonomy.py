from datetime import datetime, timezone

from autonomy import build_copy_plan
from models import AccountState, Provenance, TradeRecord, TraderSnapshot


def sample(now):
    trades = [
        TradeRecord(symbol="BTCUSDT", direction="LONG", leverage=5, margin_usdt=10,
                    pnl_usdt=2 if i % 3 else -0.2, pnl_ratio_pct=8 if i % 3 else -1)
        for i in range(12)
    ]
    trader = TraderSnapshot(
        name="Steady", trader_id="steady-1", win_rate_pct=75,
        executable_min_margin_usdt=50, recent_trades=trades,
        source_timestamp=now,
        provenance=Provenance(source="manual", confidence=0.99),
    )
    account = AccountState(
        total_usdt=1000, futures_free_usdt=500, wallet_usdt=0, open_margin_usdt=0,
        source_timestamp=now,
        provenance=Provenance(source="manual", confidence=0.99),
    )
    return trader, account


def test_plan_is_bounded_and_never_executes():
    now = datetime.now(timezone.utc)
    trader, account = sample(now)
    plan = build_copy_plan([trader], account, now=now)
    assert plan["status"] == "PLAN_ONLY"
    assert plan["account"]["reserve_usdt"] == 500
    assert plan["account"]["copy_exposure_cap_usdt"] == 200
    assert plan["selected"][0]["allocation_usdt"] == 50
    assert plan["selected"][0]["status"] == "PLAN_ONLY"
    assert plan["maintenance_policy"]["withdrawals_enabled"] is False


def test_stale_account_blocks_every_candidate():
    now = datetime.now(timezone.utc)
    trader, account = sample(now)
    account.source_timestamp = datetime(2020, 1, 1, tzinfo=timezone.utc)
    plan = build_copy_plan([trader], account, now=now)
    assert plan["selected"] == []
    assert any("Account snapshot is stale" in reason
               for item in plan["excluded"] for reason in item["reasons"])


def test_low_confidence_source_is_excluded():
    now = datetime.now(timezone.utc)
    trader, account = sample(now)
    trader.provenance.confidence = 0.4
    plan = build_copy_plan([trader], account, now=now)
    assert plan["selected"] == []
    assert any("provenance confidence" in reason
               for item in plan["excluded"] for reason in item["reasons"])


def test_daily_loss_circuit_breaker_blocks_new_allocations():
    now = datetime.now(timezone.utc)
    trader, account = sample(now)
    account.realized_pnl_today_usdt = -40
    plan = build_copy_plan([trader], account, now=now)
    assert plan["selected"] == []
    assert any("Daily realized-loss circuit breaker" in reason
               for item in plan["excluded"] for reason in item["reasons"])


def test_bitget_candidate_requires_native_project_mapping():
    now = datetime.now(timezone.utc)
    trader, account = sample(now)
    trader.exchange = "bitget"
    account.exchange = "bitget"
    plan = build_copy_plan([trader], account, now=now)
    assert plan["selected"] == []
    assert any("project ID is missing" in reason
               for item in plan["excluded"] for reason in item["reasons"])

    trader.exchange_project_id = "bg-project-123"
    plan = build_copy_plan([trader], account, now=now)
    assert plan["selected"][0]["exchange"] == "bitget"
    assert plan["selected"][0]["exchange_project_id"] == "bg-project-123"


def test_maintenance_flags_deteriorating_follow_and_does_not_execute():
    from maintenance import build_maintenance_plan

    now = datetime.now(timezone.utc)
    trader, account = sample(now)
    trader.currently_following = True
    trader.recent_trades[0].leverage = 25
    plan = build_maintenance_plan([trader], account, now=now)
    assert plan["status"] == "REVIEW_ONLY"
    assert plan["stop_review"][0]["decision"] == "STOP_AND_REPLACE_REVIEW"
    assert plan["execution"].startswith("No unfollow")


def test_maintenance_pauses_new_allocations_when_followed_trader_data_is_stale():
    from maintenance import build_maintenance_plan

    now = datetime.now(timezone.utc)
    trader, account = sample(now)
    trader.currently_following = True
    trader.source_timestamp = datetime(2020, 1, 1, tzinfo=timezone.utc)
    plan = build_maintenance_plan([trader], account, now=now)
    assert plan["retain"][0]["decision"] == "PAUSE_NEW_ALLOCATIONS"
    assert plan["stop_review"] == []


def test_cross_exchange_account_snapshot_cannot_fund_bitget_candidate():
    now = datetime.now(timezone.utc)
    trader, account = sample(now)
    trader.exchange = "bitget"
    trader.exchange_project_id = "bg-project-123"
    plan = build_copy_plan([trader], account, now=now)
    assert plan["selected"] == []
    assert any("does not match account snapshot venue" in reason
               for item in plan["excluded"] for reason in item["reasons"])
