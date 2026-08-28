from models import AccountState, TradeRecord, TraderSnapshot
from workflow import (
    ActionStatus,
    ActionType,
    BrowserStepResult,
    EarnProduct,
    FailedOrder,
    RewardItem,
    WorkflowAction,
    diagnose_failed_order,
    earn_actions,
    propose_capital_routing,
    propose_copy_configuration,
    reward_actions,
    side_effect_allowed,
)


def account():
    return AccountState(total_usdt=55, futures_free_usdt=1.34, wallet_usdt=53.4, open_margin_usdt=0)


def good_trader():
    return TraderSnapshot(
        name="steady",
        trader_id="t-good",
        win_rate_pct=60,
        executable_min_margin_usdt=10,
        recent_trades=[
            TradeRecord(symbol="ETHUSDT", direction="LONG", leverage=20, margin_usdt=10, pnl_usdt=2, pnl_ratio_pct=20),
            TradeRecord(symbol="BTCUSDT", direction="SHORT", leverage=15, margin_usdt=10, pnl_usdt=-0.5, pnl_ratio_pct=-5),
            TradeRecord(symbol="SOLUSDT", direction="LONG", leverage=10, margin_usdt=10, pnl_usdt=1.5, pnl_ratio_pct=15),
        ],
    )


def test_capital_route_only_moves_shortfall():
    a = propose_capital_routing(account(), 20)
    assert a.payload["amount_usdt"] == 18.66
    assert a.requires_approval is True


def test_copy_prepare_uses_bounded_settings():
    a = propose_copy_configuration(good_trader(), account())
    assert a.status == ActionStatus.PROPOSED
    assert a.payload["per_order_margin_usdt"] == 10
    assert a.payload["max_copy_margin_usdt"] == 20
    assert a.payload["copy_ongoing_positions"] is False


def test_failed_order_minimum_contract_math():
    d = diagnose_failed_order(FailedOrder(raw_message="minimum size 0.01 BTC", minimum_contract_qty=.01, market_price=80000, leverage=10))
    assert d["kind"] == "MINIMUM_CONTRACT_INCOMPATIBLE"
    assert d["estimated_required_margin_usdt"] == 80


def test_claimable_reward_can_be_preapproved_low_risk():
    rows = reward_actions([RewardItem(reward_id="r1", title="voucher", amount_usdt=5, claimable=True, provenance_confidence=.99)])
    assert len(rows) == 1
    assert rows[0].requires_approval is False


def test_earn_requires_eligibility_and_capital():
    rows = earn_actions([EarnProduct(product_id="e1", asset="USDT", estimated_apy_pct=10, minimum_usdt=100, available=True, account_eligible=True)], account())
    assert rows == []


def test_browser_gate_blocks_unapproved_side_effect():
    action = WorkflowAction(action_type=ActionType.TRANSFER, key="x", title="x", rationale="x", requires_approval=True)
    ok, _ = side_effect_allowed(action, BrowserStepResult(step="form", success=True, confidence=.999))
    assert ok is False
    action.status = ActionStatus.APPROVED
    ok, _ = side_effect_allowed(action, BrowserStepResult(step="form", success=True, confidence=.999))
    assert ok is True


def test_withdrawal_is_human_only():
    action = WorkflowAction(action_type=ActionType.WITHDRAWAL, key="x", title="x", rationale="x", requires_approval=False, status=ActionStatus.APPROVED)
    ok, reason = side_effect_allowed(action, None)
    assert ok is False
    assert "human-only" in reason
