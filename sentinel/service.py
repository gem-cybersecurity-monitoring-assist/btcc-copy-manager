from __future__ import annotations

import asyncio

from autonomy import build_copy_plan
from agent_review import apply_ai_veto, run_ai_review
from models import Alert, CollectorBatch
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

    def _build_plans(self, batch: CollectorBatch) -> tuple[dict, dict, dict]:
        plan = build_copy_plan(batch.traders, batch.account)
        ai_review = run_ai_review(batch.traders)
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
        return plan, maintenance, ai_review

    def ingest(self, batch: CollectorBatch) -> dict:
        inserted = self.store.save_batch(batch)
        ranked = self.monitor.rank(batch.traders, batch.account)
        plan, maintenance, ai_review = self._build_plans(batch)
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
        ranked = self.monitor.rank(batch.traders, batch.account)
        plan, maintenance, ai_review = self._build_plans(batch)
        self._emit_material_alerts(ranked)
        action_ids = self._prepare_workflows(batch, ranked)
        return {
            "status": "ok",
            "captured_at": batch.captured_at.isoformat(),
            "ranked": ranked,
            "autonomy_plan": plan,
            "maintenance_plan": maintenance,
            "ai_review": ai_review,
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
