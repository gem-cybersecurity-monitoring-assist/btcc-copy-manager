from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from bitget_copy import BitgetCopyAdapter, BitgetError
from models import AccountState, CollectorBatch, Signal, TraderSnapshot
from monitor import TraderMonitor
from risk import approve_signal
from service import SentinelService
from storage import EventStore
from workflow import (
    ActionStatus,
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

DEFAULT_DB_PATH = "/tmp/sentinel.db" if os.getenv("VERCEL") else "data/sentinel.db"
DB_PATH = os.getenv("SENTINEL_DB", DEFAULT_DB_PATH)
SCAN_INTERVAL = int(os.getenv("SENTINEL_SCAN_INTERVAL", "60"))
store = EventStore(DB_PATH)
service = SentinelService(store, SCAN_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(service.run_forever())
    yield
    service.stop()
    await task


app = FastAPI(title="BTCC Sentinel", version="0.3.1", lifespan=lifespan)


class RankRequest(BaseModel):
    account: AccountState
    traders: list[TraderSnapshot]


class SignalRequest(BaseModel):
    account: AccountState
    signal: Signal


class CapitalRouteRequest(BaseModel):
    account: AccountState
    required_margin_usdt: float


class CopyPrepRequest(BaseModel):
    account: AccountState
    trader: TraderSnapshot


class RewardsRequest(BaseModel):
    items: list[RewardItem]


class EarnRequest(BaseModel):
    account: AccountState
    products: list[EarnProduct]


class BrowserGateRequest(BaseModel):
    action: WorkflowAction
    last_browser_step: BrowserStepResult | None = None


class BitgetProjectRequest(BaseModel):
    project_id: str


class BitgetFollowRequest(BaseModel):
    project_id: str
    idempotency_key: str = Field(min_length=12, max_length=128)
    amount_usdt: float
    max_position_value: float
    leverage: int = 3
    trading_pairs: list[str] | None = None
    margin_per_order: float = 5.0


class BitgetUnfollowRequest(BaseModel):
    project_id: str
    idempotency_key: str = Field(min_length=12, max_length=128)
    close_type: str = "follow_close"


class BitgetCloseRequest(BaseModel):
    project_id: str
    idempotency_key: str = Field(min_length=12, max_length=128)


def _bitget_control(token: str):
    import hmac
    expected = os.getenv("SENTINEL_CONTROL_TOKEN", "").strip()
    if not expected or not token or not hmac.compare_digest(expected, token):
        raise HTTPException(status_code=403, detail="Sentinel control authentication failed.")


def _run_bitget_mutation(idempotency_key: str, action_type: str, project_id: str, payload: dict, operation):
    try:
        created, existing = store.begin_exchange_action(
            idempotency_key, "bitget", action_type, project_id, payload
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    if not created:
        if existing["status"] == "EXECUTED":
            return json.loads(existing["response_json"] or "{}")
        raise HTTPException(
            status_code=409,
            detail=f"Idempotent action already exists in {existing['status']} state; reconcile exchange state before any retry.",
        )
    try:
        result = operation()
        store.finish_exchange_action(idempotency_key, "EXECUTED", response=result if isinstance(result, dict) else {"result": result})
        return result
    except Exception as exc:
        store.finish_exchange_action(idempotency_key, "UNKNOWN", error=str(exc)[:500])
        raise HTTPException(status_code=503, detail=f"Bitget action outcome is uncertain; reconcile before retry: {exc}") from None


@app.get("/health")
def health():
    latest = store.latest_batch()
    return {
        "ok": True,
        "mode": "observe+workflow-prep",
        "version": "0.3.1",
        "has_data": latest is not None,
        "latest_capture": latest.captured_at.isoformat() if latest else None,
    }


@app.get("/browserbase/credential-check")
def browserbase_credential_check():
    api_key = os.getenv("BROWSERBASE_API_KEY")
    project_id = os.getenv("BROWSERBASE_PROJECT_ID")
    if not api_key or not project_id:
        raise HTTPException(status_code=503, detail={"ok": False, "configured": False})

    request = Request(
        f"https://api.browserbase.com/v1/projects/{quote(project_id, safe='')}",
        headers={"X-BB-API-Key": api_key},
        method="GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
    except HTTPError as exc:
        raise HTTPException(
            status_code=exc.code,
            detail={"ok": False, "configured": True, "browserbase_status": exc.code},
        ) from None
    except (URLError, TimeoutError):
        raise HTTPException(
            status_code=502,
            detail={"ok": False, "configured": True, "browserbase_status": "unreachable"},
        ) from None

    return {
        "ok": True,
        "configured": True,
        "project_matched": payload.get("id") == project_id,
    }


@app.post("/collector/batch")
def collector_batch(batch: CollectorBatch):
    return service.ingest(batch)


@app.get("/state/latest")
def state_latest():
    batch = store.latest_batch()
    if not batch:
        raise HTTPException(status_code=404, detail="No collector data has been ingested")
    return batch


@app.get("/alerts")
def alerts(limit: int = 50):
    return store.recent_alerts(max(1, min(limit, 200)))


@app.post("/scan")
def scan():
    return service.scan_latest()


@app.post("/rank-traders")
def rank_traders(req: RankRequest):
    return TraderMonitor().rank(req.traders, req.account)


@app.post("/risk-check")
def risk_check(req: SignalRequest):
    return approve_signal(req.signal, req.account)


@app.post("/workflow/capital-route")
def capital_route(req: CapitalRouteRequest):
    action = propose_capital_routing(req.account, req.required_margin_usdt)
    action_id = store.save_action(action)
    return {"id": action_id, "action": action}


@app.post("/workflow/copy-prepare")
def copy_prepare(req: CopyPrepRequest):
    action = propose_copy_configuration(req.trader, req.account)
    action_id = store.save_action(action)
    return {"id": action_id, "action": action}


@app.post("/workflow/failed-order-diagnose")
def failed_order_diagnose(req: FailedOrder):
    return diagnose_failed_order(req)


@app.post("/workflow/rewards")
def rewards(req: RewardsRequest):
    return [{"id": store.save_action(action), "action": action} for action in reward_actions(req.items)]


@app.post("/workflow/earn")
def earn(req: EarnRequest):
    return [{"id": store.save_action(action), "action": action} for action in earn_actions(req.products, req.account)]


@app.get("/workflow/actions")
def actions(status: str | None = None, limit: int = 100):
    return store.list_actions(status=status, limit=max(1, min(limit, 500)))


@app.post("/workflow/actions/{action_id}/approve")
def approve_action(action_id: int):
    if not store.get_action(action_id):
        raise HTTPException(status_code=404, detail="Action not found")
    store.update_action_status(action_id, ActionStatus.APPROVED)
    return store.get_action(action_id)


@app.post("/workflow/actions/{action_id}/reject")
def reject_action(action_id: int):
    if not store.get_action(action_id):
        raise HTTPException(status_code=404, detail="Action not found")
    store.update_action_status(action_id, ActionStatus.REJECTED)
    return store.get_action(action_id)


@app.post("/workflow/browser-gate")
def browser_gate(req: BrowserGateRequest):
    allowed, reason = side_effect_allowed(req.action, req.last_browser_step)
    return {"allowed": allowed, "reason": reason}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8421"))
    uvicorn.run(app, host="127.0.0.1", port=port)

@app.get("/bitget/status")
def bitget_status():
    return BitgetCopyAdapter().status()


@app.post("/bitget/current-copy")
def bitget_current_copy(req: BitgetProjectRequest):
    try:
        return BitgetCopyAdapter().current_copy(req.project_id)
    except BitgetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@app.post("/bitget/profit-details")
def bitget_profit_details(req: BitgetProjectRequest):
    try:
        return BitgetCopyAdapter().profit_details(req.project_id)
    except BitgetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@app.post("/bitget/current-positions")
def bitget_current_positions(req: BitgetProjectRequest):
    try:
        return BitgetCopyAdapter().current_positions(req.project_id)
    except BitgetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@app.post("/bitget/follow")
def bitget_follow(req: BitgetFollowRequest, x_sentinel_control: str = Header(default="")):
    _bitget_control(x_sentinel_control)
    try:
        return _run_bitget_mutation(
            req.idempotency_key, "FOLLOW", req.project_id,
            req.model_dump(exclude={"idempotency_key"}),
            lambda: BitgetCopyAdapter().follow(
                req.project_id, req.amount_usdt, copy_type="fixed_margin",
                leverage=req.leverage, auto_copy="off",
                max_position_value=req.max_position_value,
                trading_pairs=req.trading_pairs or None,
                margin_per_order=req.margin_per_order,
            ),
        )
    except BitgetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@app.post("/bitget/unfollow")
def bitget_unfollow(req: BitgetUnfollowRequest, x_sentinel_control: str = Header(default="")):
    _bitget_control(x_sentinel_control)
    try:
        return _run_bitget_mutation(
            req.idempotency_key, "UNFOLLOW", req.project_id,
            req.model_dump(exclude={"idempotency_key"}),
            lambda: BitgetCopyAdapter().unfollow(req.project_id, close_type=req.close_type),
        )
    except BitgetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@app.post("/bitget/close-all")
def bitget_close_all(req: BitgetCloseRequest, x_sentinel_control: str = Header(default="")):
    _bitget_control(x_sentinel_control)
    try:
        return _run_bitget_mutation(
            req.idempotency_key, "CLOSE_ALL", req.project_id,
            req.model_dump(exclude={"idempotency_key"}),
            lambda: BitgetCopyAdapter().close_all(req.project_id),
        )
    except BitgetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
