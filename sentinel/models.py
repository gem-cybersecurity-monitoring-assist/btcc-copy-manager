from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Verdict(str, Enum):
    COPY = "COPY"
    SMALL_TEST = "SMALL_TEST"
    WATCH = "WATCH"
    REJECT = "REJECT"


class Provenance(BaseModel):
    source: Literal["dom", "xhr", "screenshot", "manual", "derived", "unknown"] = "unknown"
    page_url: str | None = None
    confidence: float = Field(default=1.0, ge=0, le=1)
    captured_at: datetime = Field(default_factory=utcnow)


class TradeRecord(BaseModel):
    symbol: str
    direction: str
    leverage: float = Field(gt=0)
    margin_usdt: float = Field(ge=0)
    pnl_usdt: float
    pnl_ratio_pct: float
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    close_reason: str | None = None
    provenance: Provenance | None = None


class TraderSnapshot(BaseModel):
    name: str
    trader_id: str | None = None
    exchange: Literal["btcc", "bitget"] = "btcc"
    exchange_project_id: str | None = None
    pnl_30d_pct: float | None = None
    aum_usdt: float | None = None
    win_rate_pct: float | None = None
    copiers: int | None = None
    copier_capacity: int | None = None
    recent_trades: list[TradeRecord] = Field(default_factory=list)
    executable_min_margin_usdt: float | None = None
    source_timestamp: datetime = Field(default_factory=utcnow)
    provenance: Provenance | None = None


class AccountState(BaseModel):
    total_usdt: float = Field(ge=0)
    futures_free_usdt: float = Field(ge=0)
    wallet_usdt: float = Field(ge=0)
    open_margin_usdt: float = Field(ge=0)
    realized_pnl_today_usdt: float = 0
    active_positions: int = 0
    source_timestamp: datetime = Field(default_factory=utcnow)
    provenance: Provenance | None = None


class Signal(BaseModel):
    source: str
    symbol: str
    direction: str
    confidence: float = Field(ge=0, le=1)
    entry: float
    stop: float
    target: float
    proposed_margin_usdt: float = Field(gt=0)
    leverage: float = Field(gt=0)
    expires_at: datetime | None = None


class RiskDecision(BaseModel):
    allowed: bool
    reasons: list[str]
    max_margin_usdt: float = 0
    estimated_max_loss_usdt: float | None = None


class CollectorBatch(BaseModel):
    account: AccountState
    traders: list[TraderSnapshot]
    collector_id: str = "btcc-browser-adapter"
    captured_at: datetime = Field(default_factory=utcnow)


class Alert(BaseModel):
    kind: str
    key: str
    severity: Literal["info", "opportunity", "warning", "critical"]
    message: str
    created_at: datetime = Field(default_factory=utcnow)
    data: dict = Field(default_factory=dict)


class FundingEvent(BaseModel):
    kind: str
    amount_usdt: float
    symbol: str | None = None
    trader_name: str | None = None
    occurred_at: datetime | None = None
    note: str | None = None
    provenance: Provenance | None = None


class RewardSnapshot(BaseModel):
    reward_id: str
    title: str
    amount_usdt: float | None = None
    claimable: bool = False
    already_received: bool = False
    expires_at: datetime | None = None
    provenance: Provenance | None = None


class EarnSnapshot(BaseModel):
    product_id: str
    asset: str
    estimated_apy_pct: float
    minimum_usdt: float
    available: bool
    account_eligible: bool
    flexible: bool = True
    provenance: Provenance | None = None
