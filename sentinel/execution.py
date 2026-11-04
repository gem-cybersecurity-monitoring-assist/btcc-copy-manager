from __future__ import annotations

import hashlib
import os
from collections import Counter
from typing import Any

from bitget_copy import BitgetCopyAdapter, BitgetError
from models import CollectorBatch
from storage import EventStore


class BitgetAutoExecutor:
    """Idempotent, bounded execution coordinator. All live switches default off."""

    def __init__(self, store: EventStore, adapter: BitgetCopyAdapter | None = None):
        self.store = store
        self.adapter = adapter or BitgetCopyAdapter()

    def execute(self, batch: CollectorBatch, plan: dict, maintenance: dict) -> dict[str, Any]:
        follow_enabled = os.getenv("GEM_AUTO_COPY_EXECUTION_ENABLED", "false").lower() == "true"
        stop_enabled = os.getenv("GEM_AUTO_STOP_REPLACE_ENABLED", "false").lower() == "true"
        if not (follow_enabled or stop_enabled):
            return {"status": "disabled", "actions": [], "reason": "Autonomous exchange execution is disabled."}
        if batch.account.exchange != "bitget":
            return {"status": "blocked", "actions": [], "reason": "The account snapshot is not from Bitget."}
        if not self.adapter.config.live_enabled:
            return {"status": "blocked", "actions": [], "reason": "Bitget live mutation flag is disabled."}

        actions: list[dict[str, Any]] = []
        snapshot_key = batch.captured_at.isoformat()

        if stop_enabled:
            actions.extend(self._stop_deteriorating(maintenance, snapshot_key))

        if follow_enabled:
            if not self.adapter.config.internal_transfer_enabled:
                actions.append({
                    "action": "FOLLOW",
                    "status": "blocked",
                    "reason": "Explicit Bitget internal copy-account funding permission is disabled.",
                })
            else:
                actions.extend(self._follow_qualified(batch, plan, snapshot_key))

        return {"status": "completed" if actions else "no_actions", "actions": actions}

    def _stop_deteriorating(self, maintenance: dict, snapshot_key: str) -> list[dict[str, Any]]:
        results = []
        for item in maintenance.get("stop_review", []):
            if item.get("exchange") != "bitget" or not item.get("project_id"):
                continue
            project_id = item["project_id"]
            active = self.store.get_active_subscription(project_id)
            if not active:
                continue
            latest = self.store.latest_exchange_action("bitget", project_id)
            if latest and latest["action_type"] == "UNFOLLOW" and latest["status"] == "EXECUTED":
                try:
                    positions = self.adapter.current_positions(project_id)
                    position_list = positions.get("list", []) if isinstance(positions, dict) else positions
                    if not position_list:
                        self.store.mark_subscription_inactive(project_id)
                        results.append({"action": "UNFOLLOW", "project_id": project_id, "status": "reconciled_inactive"})
                    else:
                        results.append({"action": "UNFOLLOW", "project_id": project_id, "status": "reconciliation_required", "open_positions": len(position_list)})
                except BitgetError as exc:
                    results.append({"action": "UNFOLLOW", "project_id": project_id, "status": "reconciliation_required", "reason": str(exc)[:300]})
                continue
            if latest and latest["status"] in {"PENDING", "UNKNOWN"}:
                results.append({"action": "UNFOLLOW", "project_id": project_id, "status": "reconciliation_required"})
                continue
            key = "auto-unfollow:" + hashlib.sha256(f"{project_id}:{snapshot_key}".encode()).hexdigest()[:40]
            payload = {"project_id": project_id, "close_type": "instant_close", "reasons": item.get("reasons", [])}
            try:
                created, existing = self.store.begin_exchange_action(key, "bitget", "UNFOLLOW", project_id, payload)
            except ValueError:
                results.append({"action": "UNFOLLOW", "project_id": project_id, "status": "idempotency_conflict"})
                continue
            if not created:
                results.append({"action": "UNFOLLOW", "project_id": project_id, "status": existing["status"].lower()})
                continue
            try:
                response = self.adapter.unfollow(project_id, close_type="instant_close")
                positions = self.adapter.current_positions(project_id)
                position_list = positions.get("list", []) if isinstance(positions, dict) else positions
                if position_list:
                    self.store.finish_exchange_action(key, "UNKNOWN", response={"unfollow": response}, error="Positions remain after instant-close request.")
                    results.append({"action": "UNFOLLOW", "project_id": project_id, "status": "reconciliation_required", "open_positions": len(position_list)})
                    continue
                self.store.finish_exchange_action(key, "EXECUTED", response={"unfollow": response, "positions": positions if isinstance(positions, dict) else {"list": position_list}})
                self.store.mark_subscription_inactive(project_id)
                results.append({"action": "UNFOLLOW", "project_id": project_id, "status": "executed"})
            except Exception as exc:
                self.store.finish_exchange_action(key, "UNKNOWN", error=str(exc)[:500])
                results.append({"action": "UNFOLLOW", "project_id": project_id, "status": "reconciliation_required", "reason": str(exc)[:300]})
        return results

    def _follow_qualified(self, batch: CollectorBatch, plan: dict, snapshot_key: str) -> list[dict[str, Any]]:
        results = []
        by_key = {(t.trader_id or t.name): t for t in batch.traders}
        for candidate in plan.get("selected", []):
            if candidate.get("exchange") != "bitget":
                continue
            project_id = candidate.get("exchange_project_id")
            if not project_id:
                continue
            active = self.store.get_active_subscription(project_id)
            if active:
                try:
                    settings = self.adapter.copy_settings(project_id)
                    current = self.adapter.current_copy(project_id)
                    profit = self.adapter.profit_details(project_id)
                    results.append({"action": "FOLLOW", "project_id": project_id, "status": "already_active", "settings": settings, "current_copy": current, "profit_details": profit})
                except BitgetError as exc:
                    results.append({"action": "FOLLOW", "project_id": project_id, "status": "reconciliation_required", "reason": str(exc)[:300]})
                continue

            latest = self.store.latest_exchange_action("bitget", project_id)
            if latest:
                if latest["status"] in {"PENDING", "UNKNOWN"} or (latest["action_type"] == "FOLLOW" and latest["status"] == "EXECUTED"):
                    results.append({"action": "FOLLOW", "project_id": project_id, "status": "reconciliation_required"})
                    continue
                if latest["action_type"] != "UNFOLLOW" or latest["status"] != "EXECUTED":
                    results.append({"action": "FOLLOW", "project_id": project_id, "status": "blocked_by_prior_action"})
                    continue

            trader = by_key.get(candidate.get("trader_id") or candidate.get("trader"))
            if trader is None:
                results.append({"action": "FOLLOW", "project_id": project_id, "status": "blocked", "reason": "Trader snapshot missing."})
                continue
            trading_pairs = [symbol for symbol, _ in Counter(t.symbol for t in trader.recent_trades).most_common(3)]
            if not trading_pairs:
                results.append({"action": "FOLLOW", "project_id": project_id, "status": "blocked", "reason": "No verified trading-pair history."})
                continue

            key = "auto-follow:" + hashlib.sha256(f"{project_id}:{snapshot_key}".encode()).hexdigest()[:40]
            payload = {
                "project_id": project_id,
                "amount_usdt": candidate["allocation_usdt"],
                "leverage": candidate["max_leverage"],
                "max_position_value_usdt": candidate["max_position_value_usdt"],
                "margin_per_order_usdt": candidate["margin_per_order_usdt"],
                "trading_pairs": trading_pairs,
            }
            try:
                created, existing = self.store.begin_exchange_action(key, "bitget", "FOLLOW", project_id, payload)
            except ValueError:
                results.append({"action": "FOLLOW", "project_id": project_id, "status": "idempotency_conflict"})
                continue
            if not created:
                results.append({"action": "FOLLOW", "project_id": project_id, "status": existing["status"].lower()})
                continue
            try:
                response = self.adapter.follow(
                    project_id,
                    float(candidate["allocation_usdt"]),
                    copy_type="fixed_margin",
                    leverage=int(candidate["max_leverage"]),
                    auto_copy="off",
                    max_position_value=float(candidate["max_position_value_usdt"]),
                    trading_pairs=trading_pairs,
                    margin_per_order=float(candidate["margin_per_order_usdt"]),
                )
                settings = self.adapter.copy_settings(project_id)
                current = self.adapter.current_copy(project_id)
                if settings.get("autoCopy") != "off" or int(float(settings.get("leverage") or 0)) != int(candidate["max_leverage"]):
                    raise BitgetError("Post-follow settings did not match the bounded execution policy.")
                self.store.mark_subscription_active(
                    project_id, "bitget", trader.trader_id, trader.name,
                    float(candidate["allocation_usdt"]), int(candidate["max_leverage"]),
                    float(candidate["max_position_value_usdt"]),
                )
                self.store.finish_exchange_action(key, "EXECUTED", response={"follow": response, "settings": settings, "current_copy": current})
                results.append({"action": "FOLLOW", "project_id": project_id, "status": "executed", "settings": settings})
            except Exception as exc:
                self.store.finish_exchange_action(key, "UNKNOWN", error=str(exc)[:500])
                results.append({"action": "FOLLOW", "project_id": project_id, "status": "reconciliation_required", "reason": str(exc)[:300]})
        return results
