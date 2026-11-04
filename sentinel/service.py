from __future__ import annotations

import asyncio
from threading import Lock

from autonomy import build_copy_plan
from agent_review import apply_ai_veto, run_ai_review
from execution import BitgetAutoExecutor
from models import Alert, CollectorBatch, Provenance
from monitor import TraderMonitor
from maintenance import build_maintenance_plan
from storage import EventStore
from workflow import propose_copy_configuration


class SentinelService:
    def __init__(self, store: EventStore, scan_interval_seconds: int = 60):
        self.store = store
        self.scan_interval_seconds = max(10, scan_interval_seconds)
        self.monitor = TraderMonitor()
        self._stop = asyncio.Event()
        self.executor = BitgetAutoExecutor(store)
        self._last_ai_review_key: str | None = None
        self._last_ai_review: dict | None = None
        self._ai_review_lock = Lock()

    def _ai_review_for(self, batch: CollectorBatch) -> dict:
        key = batch.captured_at.isoformat()
        with self._ai_review_lock:
            if key == self._last_ai_review_key and self._last_ai_review is not None:
                return self._last_ai_review
            review = run_ai_review(batch.traders)
            self._last_ai_review_key = key
            self._last_ai_review = review
            return review

    def _build_plans(self, batch: CollectorBatch) -> tuple[dict, dict, dict]:
        active_projects = {
            row["project_id"] for row in self.store.list_active_subscriptions()
        }
        for trader in batch.traders:
            if trader.exchange == "bitget" and trader.exchange_project_id in active_projects:
                trader.currently_following = True
        if batch.account.exchange == "bitget":
            if self.executor.adapter.config.configured:
                try:
                    batch.account = self.executor.adapter.account_snapshot()
                except Exception:
                    batch.account.provenance = Provenance(source="unknown", confidence=0.0)
            else:
                batch.account.provenance = Provenance(source="unknown", confidence=0.0)
        plan = build_copy_plan(batch.traders, batch.account)
        ai_review = self._ai_review_for(batch)
        plan = apply_ai_veto(plan, ai_review)
        maintenance = build_maintenance_plan(batch.traders, batch.account)
        if ai_review.get("enabled"):
            if ai_review.get("status") != "ok":
                maintenance["replacement_candidates"] = []
            else:
                veto_ids = set(ai_review.get("veto_ids", []))
                maintenance["replacement_candidates"] = [
                    row for row in maintenance.get("replacement_candidates", [])
                    if (row.get("trader_id") or row.get("exchange_project_id") or row.get("trader")) not in veto_ids
                ]
                active_ids = {
                    t.trader_id or t.exchange_project_id or t.name
                    for t in batch.traders if t.currently_following
                }
                for review in ai_review.get("reviews", []):
                    if review.get("trader_id") not in active_ids:
                        continue
                    if review.get("action") == "REJECT":
                        maintenance["stop_review"].append({
                            "trader_id": review["trader_id"],
                            "decision": "STOP_AND_REPLACE_REVIEW",
                            "status": "REVIEW_ONLY",
                            "reasons": ["AI risk panel rejection: " + "; ".join(review.get("reasons", []))],
                        })
                    elif review.get("action") == "REVIEW":
                        maintenance["retain"].append({
                            "trader_id": review["trader_id"],
                            "decision": "REVIEW_FOLLOWER",
                            "reasons": review.get("reasons", []),
                        })
        return plan, maintenance, ai_review

    def ingest(self, batch: CollectorBatch) -> dict:
        inserted = self.store.save_batch(batch)
        plan, maintenance, ai_review = self._build_plans(batch)
        ranked = self.monitor.rank(batch.traders, batch.account)
        execution = self.executor.execute(batch, plan, maintenance)
        action_ids: list[int] = []
        if inserted:
            self._emit_material_alerts(ranked)
            action_ids = self._prepare_workflows(batch, ranked)
        return {
            "stored": inserted,
            "ranked": ranked,
            "autonomy_plan": plan,
            "maintenance_plan": maintenance,
            "ai_review": ai_review,
            "execution": execution,
            "prepared_action_ids": action_ids,
        }

    def _emit_material_alerts(self, ranked: list[dict]) -> None:
        for row in ranked:
            verdict = row["verdict"]
            if verdict in {"COPY", "SMALL_TEST"}:
                self.store.add_alert(Alert(
                    kind="trader_opportunity",
                    key=row["trader_id"] or row["trader"],
                    severity="opportunity",
                    message=f"{row['trader']} classified {verdict} with score {row['score']}",
                    data=row,
                ))
            elif verdict == "REJECT" and any("hard reject" in r.lower() or "lost" in r.lower() for r in row["reasons"]):
                self.store.add_alert(Alert(
                    kind="trader_risk",
                    key=row["trader_id"] or row["trader"],
                    severity="warning",
                    message=f"{row['trader']} rejected by hard risk evidence",
                    data=row,
                ))

    def _prepare_workflows(self, batch: CollectorBatch, ranked: list[dict]) -> list[int]:
        by_key = {(t.trader_id or t.name): t for t in batch.traders}
        ids: list[int] = []
        for row in ranked:
            if row["verdict"] not in {"COPY", "SMALL_TEST"}:
                continue
            trader = by_key.get(row["trader_id"] or row["trader"])
            if not trader:
                continue
            action = propose_copy_configuration(trader, batch.account)
            ids.append(self.store.save_action(action))
        return ids

    def scan_latest(self) -> dict:
        batch = self.store.latest_batch()
        if not batch:
            return {"status": "no_data", "ranked": [], "autonomy_plan": None, "maintenance_plan": None}
        plan, maintenance, ai_review = self._build_plans(batch)
        ranked = self.monitor.rank(batch.traders, batch.account)
        execution = self.executor.execute(batch, plan, maintenance)
        self._emit_material_alerts(ranked)
        action_ids = self._prepare_workflows(batch, ranked)
        return {
            "status": "ok",
            "captured_at": batch.captured_at.isoformat(),
            "ranked": ranked,
            "autonomy_plan": plan,
            "maintenance_plan": maintenance,
            "ai_review": ai_review,
            "execution": execution,
            "prepared_action_ids": action_ids,
        }

    async def run_forever(self) -> None:
        while not self._stop.is_set():
            self.scan_latest()
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.scan_interval_seconds)
            except asyncio.TimeoutError:
                pass

    def stop(self) -> None:
        self._stop.set()
