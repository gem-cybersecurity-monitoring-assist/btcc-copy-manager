from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from models import AccountState, TraderSnapshot
from monitor import TraderMonitor
from risk import RiskPolicy


def utcnow():
    return datetime.now(timezone.utc)


class ActionType(str, Enum):
    TRANSFER = "TRANSFER"
    COPY_CONFIGURE = "COPY_CONFIGURE"
    COPY_START = "COPY_START"
    COPY_STOP = "COPY_STOP"
    REWARD_CLAIM = "REWARD_CLAIM"
    EARN_SUBSCRIBE = "EARN_SUBSCRIBE"
    PAPER_ORDER = "PAPER_ORDER"
    LIVE_ORDER = "LIVE_ORDER"
    WITHDRAWAL = "WITHDRAWAL"
    SECURITY_CHANGE = "SECURITY_CHANGE"


class ActionStatus(str, Enum):
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTED = "EXECUTED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"


class WorkflowAction(BaseModel):
    action_type: ActionType
    key: str
    title: str
    rationale: str
    payload: dict[str, Any] = Field(default_factory=dict)
    requires_approval: bool = True
    status: ActionStatus = ActionStatus.PROPOSED
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime | None = None


class RewardItem(BaseModel):
    reward_id: str
    title: str
    amount_usdt: float | None = None
    claimable: bool = False
    expires_at: datetime | None = None
    already_received: bool = False
    provenance_confidence: float = Field(default=1.0, ge=0, le=1)


class EarnProduct(BaseModel):
    product_id: str
    asset: str
    estimated_apy_pct: float
    minimum_usdt: float
    available: bool
    account_eligible: bool
    flexible: bool = True


class FailedOrder(BaseModel):
    trader_name: str | None = None
    symbol: str | None = None
    raw_message: str
    current_per_order_usdt: float | None = None
    current_max_margin_usdt: float | None = None
    leverage: float | None = None
    market_price: float | None = None
    minimum_contract_qty: float | None = None


class BrowserStepResult(BaseModel):
    step: str
    success: bool
    selector_used: str | None = None
    confidence: float = Field(default=1.0, ge=0, le=1)
    screenshot_path: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class WorkflowPolicy:
    auto_claim_rewards_max_usdt: float = 100.0
    transfer_reserve_usdt: float = 20.0
    minimum_free_buffer_usdt: float = 5.0
    max_auto_transfer_usdt: float = 0.0
    auto_stop_on_hard_reject: bool = False
    browser_min_confidence_for_side_effect: float = 0.98


FORBIDDEN_AUTOMATION = {ActionType.WITHDRAWAL, ActionType.SECURITY_CHANGE}


def diagnose_failed_order(f: FailedOrder) -> dict:
    text = f.raw_message.lower()
    if "maximum" in text and "amount" in text:
        needed = None
        if f.current_per_order_usdt and f.current_max_margin_usdt:
            needed = max(f.current_max_margin_usdt, f.current_per_order_usdt * 2)
        return {
            "kind": "MAX_COPY_MARGIN_REACHED",
            "recommendation": "Raise trader-level maximum copy margin only if the trader still passes risk filters; do not raise per-order size automatically.",
            "suggested_max_margin_usdt": needed,
        }
    if "minimum" in text or "0.01" in text or "too low" in text:
        required = None
        if f.minimum_contract_qty and f.market_price and f.leverage:
            required = f.minimum_contract_qty * f.market_price / f.leverage
        return {
            "kind": "MINIMUM_CONTRACT_INCOMPATIBLE",
            "recommendation": "Reject or watch if required margin exceeds the small-account policy; do not increase size merely to satisfy the contract minimum.",
            "estimated_required_margin_usdt": round(required, 2) if required else None,
        }
    return {
        "kind": "UNKNOWN",
        "recommendation": "Capture the exact BTCC error, account state, and contract metadata before changing settings.",
    }


def propose_capital_routing(account: AccountState, required_margin_usdt: float, p: WorkflowPolicy = WorkflowPolicy()) -> WorkflowAction:
    needed = max(0.0, required_margin_usdt - account.futures_free_usdt)
    transferable = max(0.0, account.wallet_usdt - p.minimum_free_buffer_usdt)
    amount = round(min(needed, transferable), 2)
    rationale = (
        "Futures balance already covers the proposed opportunity or wallet reserve prevents transfer."
        if amount <= 0
        else f"Move only the ${amount:.2f} shortfall needed for the qualified opportunity; keep a wallet buffer."
    )
    return WorkflowAction(
        action_type=ActionType.TRANSFER,
        key=f"wallet-futures-{amount:.2f}",
        title="Prepare Wallet → Futures transfer",
        rationale=rationale,
        payload={"from": "wallet", "to": "futures", "amount_usdt": amount},
        requires_approval=(p.max_auto_transfer_usdt <= 0 or amount > p.max_auto_transfer_usdt),
        status=ActionStatus.PROPOSED if amount > 0 else ActionStatus.BLOCKED,
    )


def propose_copy_configuration(trader: TraderSnapshot, account: AccountState, risk_policy: RiskPolicy = RiskPolicy()) -> WorkflowAction:
    ranked = TraderMonitor(risk_policy).rank([trader], account)[0]
    if ranked["verdict"] == "REJECT":
        return WorkflowAction(
            action_type=ActionType.COPY_CONFIGURE,
            key=trader.trader_id or trader.name,
            title=f"Block copy configuration for {trader.name}",
            rationale="Trader failed deterministic filters.",
            payload={"verdict": ranked},
            status=ActionStatus.BLOCKED,
        )
    min_margin = trader.executable_min_margin_usdt or min(10.0, risk_policy.max_margin_per_trade_usdt)
    per_order = round(min(max(min_margin, 5.0), risk_policy.max_margin_per_trade_usdt), 2)
    max_margin = round(min(per_order * 2, risk_policy.max_total_open_margin_usdt, account.total_usdt), 2)
    return WorkflowAction(
        action_type=ActionType.COPY_CONFIGURE,
        key=trader.trader_id or trader.name,
        title=f"Prepare copy settings for {trader.name}",
        rationale=f"Trader classified {ranked['verdict']} with score {ranked['score']}; prepare bounded settings only.",
        payload={
            "per_order_margin_usdt": per_order,
            "max_copy_margin_usdt": max_margin,
            "copy_ongoing_positions": False,
            "auto_update": False,
            "take_profit_pct": 0,
            "stop_loss_per_order_pct": 20,
            "trader_stop_loss_usdt": min(10.0, max_margin),
            "verdict": ranked,
        },
        requires_approval=True,
    )


def reward_actions(items: list[RewardItem], p: WorkflowPolicy = WorkflowPolicy()) -> list[WorkflowAction]:
    actions: list[WorkflowAction] = []
    for item in items:
        if not item.claimable or item.already_received:
            continue
        amount = item.amount_usdt or 0.0
        low_risk = amount <= p.auto_claim_rewards_max_usdt and item.provenance_confidence >= 0.95
        actions.append(WorkflowAction(
            action_type=ActionType.REWARD_CLAIM,
            key=item.reward_id,
            title=f"Claim {item.title}",
            rationale="Reward is currently claimable and not recorded as already received.",
            payload=item.model_dump(mode="json"),
            requires_approval=not low_risk,
        ))
    return actions


def earn_actions(products: list[EarnProduct], account: AccountState) -> list[WorkflowAction]:
    rows: list[WorkflowAction] = []
    idle = account.wallet_usdt
    for product in products:
        if not (product.available and product.account_eligible):
            continue
        if idle < product.minimum_usdt:
            continue
        rows.append(WorkflowAction(
            action_type=ActionType.EARN_SUBSCRIBE,
            key=product.product_id,
            title=f"Eligible Earn product: {product.asset} {product.estimated_apy_pct:.2f}%",
            rationale="Product is visible, account-eligible, and its minimum fits current idle wallet capital.",
            payload=product.model_dump(mode="json"),
            requires_approval=True,
        ))
    return sorted(rows, key=lambda x: x.payload.get("estimated_apy_pct", 0), reverse=True)


def side_effect_allowed(action: WorkflowAction, last_browser_step: BrowserStepResult | None, p: WorkflowPolicy = WorkflowPolicy()) -> tuple[bool, str]:
    if action.action_type in FORBIDDEN_AUTOMATION:
        return False, "Withdrawal/security actions are human-only."
    if action.status not in {ActionStatus.APPROVED, ActionStatus.PROPOSED}:
        return False, f"Action status {action.status.value} cannot execute."
    if action.requires_approval and action.status != ActionStatus.APPROVED:
        return False, "Action requires explicit approval."
    if last_browser_step is not None:
        if not last_browser_step.success:
            return False, "Browser workflow has not reached a verified successful pre-action state."
        if last_browser_step.confidence < p.browser_min_confidence_for_side_effect:
            return False, "Browser selector confidence is below side-effect threshold."
    return True, "Execution gate passed."
