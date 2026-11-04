from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from threading import Lock

from models import AccountState, Alert, CollectorBatch, TraderSnapshot
from workflow import ActionStatus, WorkflowAction


class EventStore:
    def __init__(self, path: str | Path = "data/sentinel.db"):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._connect() as c:
            c.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS collector_batches (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  content_hash TEXT UNIQUE NOT NULL,
                  collector_id TEXT NOT NULL,
                  captured_at TEXT NOT NULL,
                  payload_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS alerts (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  kind TEXT NOT NULL,
                  alert_key TEXT NOT NULL,
                  severity TEXT NOT NULL,
                  message TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  data_json TEXT NOT NULL,
                  UNIQUE(kind, alert_key, message)
                );
                CREATE TABLE IF NOT EXISTS workflow_actions (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  action_key TEXT NOT NULL,
                  action_type TEXT NOT NULL,
                  title TEXT NOT NULL,
                  rationale TEXT NOT NULL,
                  requires_approval INTEGER NOT NULL,
                  status TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  expires_at TEXT,
                  payload_json TEXT NOT NULL,
                  UNIQUE(action_key, action_type, status, payload_json)
                );
                CREATE TABLE IF NOT EXISTS exchange_action_ledger (
                  idempotency_key TEXT PRIMARY KEY,
                  venue TEXT NOT NULL,
                  action_type TEXT NOT NULL,
                  project_id TEXT NOT NULL,
                  request_hash TEXT NOT NULL,
                  status TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  response_json TEXT,
                  error_text TEXT
                );
                CREATE TABLE IF NOT EXISTS active_copy_subscriptions (
                  project_id TEXT PRIMARY KEY,
                  venue TEXT NOT NULL,
                  trader_id TEXT,
                  trader_name TEXT NOT NULL,
                  amount_usdt REAL NOT NULL,
                  leverage INTEGER NOT NULL,
                  max_position_value_usdt REAL NOT NULL,
                  status TEXT NOT NULL,
                  verified_at TEXT NOT NULL
                );
                """
            )

    def save_batch(self, batch: CollectorBatch) -> bool:
        payload = batch.model_dump(mode="json")
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(raw.encode()).hexdigest()
        with self._lock, self._connect() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO collector_batches(content_hash, collector_id, captured_at, payload_json) VALUES(?,?,?,?)",
                (digest, batch.collector_id, batch.captured_at.isoformat(), raw),
            )
            return cur.rowcount == 1

    def latest_batch(self) -> CollectorBatch | None:
        with self._connect() as c:
            row = c.execute("SELECT payload_json FROM collector_batches ORDER BY id DESC LIMIT 1").fetchone()
        return CollectorBatch.model_validate_json(row["payload_json"]) if row else None

    def latest_account(self) -> AccountState | None:
        batch = self.latest_batch()
        return batch.account if batch else None

    def latest_traders(self) -> list[TraderSnapshot]:
        batch = self.latest_batch()
        return batch.traders if batch else []

    def add_alert(self, alert: Alert) -> bool:
        with self._lock, self._connect() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO alerts(kind, alert_key, severity, message, created_at, data_json) VALUES(?,?,?,?,?,?)",
                (alert.kind, alert.key, alert.severity, alert.message, alert.created_at.isoformat(), json.dumps(alert.data, sort_keys=True)),
            )
            return cur.rowcount == 1

    def recent_alerts(self, limit: int = 50) -> list[dict]:
        with self._connect() as c:
            rows = c.execute(
                "SELECT kind, alert_key, severity, message, created_at, data_json FROM alerts ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "kind": r["kind"],
                "key": r["alert_key"],
                "severity": r["severity"],
                "message": r["message"],
                "created_at": r["created_at"],
                "data": json.loads(r["data_json"]),
            }
            for r in rows
        ]

    def save_action(self, action: WorkflowAction) -> int:
        payload_json = json.dumps(action.payload, sort_keys=True, default=str)
        with self._lock, self._connect() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO workflow_actions(action_key, action_type, title, rationale, requires_approval, status, created_at, expires_at, payload_json) VALUES(?,?,?,?,?,?,?,?,?)",
                (action.key, action.action_type.value, action.title, action.rationale, int(action.requires_approval), action.status.value, action.created_at.isoformat(), action.expires_at.isoformat() if action.expires_at else None, payload_json),
            )
            if cur.rowcount == 1:
                return int(cur.lastrowid)
            row = c.execute(
                "SELECT id FROM workflow_actions WHERE action_key=? AND action_type=? AND status=? AND payload_json=? ORDER BY id DESC LIMIT 1",
                (action.key, action.action_type.value, action.status.value, payload_json),
            ).fetchone()
            return int(row["id"])

    def list_actions(self, status: str | None = None, limit: int = 100) -> list[dict]:
        with self._connect() as c:
            if status:
                rows = c.execute("SELECT * FROM workflow_actions WHERE status=? ORDER BY id DESC LIMIT ?", (status, limit)).fetchall()
            else:
                rows = c.execute("SELECT * FROM workflow_actions ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{
            "id": r["id"], "key": r["action_key"], "action_type": r["action_type"], "title": r["title"],
            "rationale": r["rationale"], "requires_approval": bool(r["requires_approval"]), "status": r["status"],
            "created_at": r["created_at"], "expires_at": r["expires_at"], "payload": json.loads(r["payload_json"])
        } for r in rows]

    def update_action_status(self, action_id: int, status: ActionStatus) -> bool:
        with self._lock, self._connect() as c:
            cur = c.execute("UPDATE workflow_actions SET status=? WHERE id=?", (status.value, action_id))
            return cur.rowcount == 1

    def get_action(self, action_id: int) -> dict | None:
        with self._connect() as c:
            r = c.execute("SELECT * FROM workflow_actions WHERE id=?", (action_id,)).fetchone()
        if not r:
            return None
        return {
            "id": r["id"], "key": r["action_key"], "action_type": r["action_type"], "title": r["title"],
            "rationale": r["rationale"], "requires_approval": bool(r["requires_approval"]), "status": r["status"],
            "created_at": r["created_at"], "expires_at": r["expires_at"], "payload": json.loads(r["payload_json"])
        }

    def begin_exchange_action(self, idempotency_key: str, venue: str, action_type: str, project_id: str, payload: dict) -> tuple[bool, dict]:
        from datetime import datetime, timezone
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        digest = hashlib.sha256(raw.encode()).hexdigest()
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as c:
            cur = c.execute(
                """INSERT OR IGNORE INTO exchange_action_ledger
                (idempotency_key, venue, action_type, project_id, request_hash, status, created_at, updated_at)
                VALUES(?,?,?,?,?,'PENDING',?,?)""",
                (idempotency_key, venue, action_type, project_id, digest, now, now),
            )
            row = c.execute(
                "SELECT * FROM exchange_action_ledger WHERE idempotency_key=?",
                (idempotency_key,),
            ).fetchone()
        result = dict(row)
        if result["request_hash"] != digest:
            raise ValueError("Idempotency key was already used for a different request payload.")
        return cur.rowcount == 1, result

    def finish_exchange_action(self, idempotency_key: str, status: str, response: dict | None = None, error: str | None = None) -> bool:
        from datetime import datetime, timezone
        if status not in {"EXECUTED", "UNKNOWN"}:
            raise ValueError("Exchange ledger status must be EXECUTED or UNKNOWN.")
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as c:
            cur = c.execute(
                """UPDATE exchange_action_ledger SET status=?, updated_at=?, response_json=?, error_text=?
                WHERE idempotency_key=? AND status='PENDING'""",
                (status, now, json.dumps(response, sort_keys=True, default=str) if response is not None else None,
                 error, idempotency_key),
            )
            return cur.rowcount == 1

    def get_exchange_action(self, idempotency_key: str) -> dict | None:
        with self._connect() as c:
            row = c.execute(
                "SELECT * FROM exchange_action_ledger WHERE idempotency_key=?",
                (idempotency_key,),
            ).fetchone()
        if not row:
            return None
        result = dict(row)
        if result.get("response_json"):
            result["response"] = json.loads(result["response_json"])
        return result


    def get_active_subscription(self, project_id: str) -> dict | None:
        with self._connect() as c:
            row = c.execute(
                "SELECT * FROM active_copy_subscriptions WHERE project_id=? AND status='ACTIVE'",
                (project_id,),
            ).fetchone()
        return dict(row) if row else None

    def mark_subscription_active(self, project_id: str, venue: str, trader_id: str | None, trader_name: str, amount_usdt: float, leverage: int, max_position_value_usdt: float) -> None:
        from datetime import datetime, timezone
        verified_at = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as c:
            c.execute(
                """INSERT INTO active_copy_subscriptions
                (project_id, venue, trader_id, trader_name, amount_usdt, leverage, max_position_value_usdt, status, verified_at)
                VALUES(?,?,?,?,?,?,?,'ACTIVE',?)
                ON CONFLICT(project_id) DO UPDATE SET
                venue=excluded.venue, trader_id=excluded.trader_id, trader_name=excluded.trader_name,
                amount_usdt=excluded.amount_usdt, leverage=excluded.leverage,
                max_position_value_usdt=excluded.max_position_value_usdt,
                status='ACTIVE', verified_at=excluded.verified_at""",
                (project_id, venue, trader_id, trader_name, amount_usdt, leverage, max_position_value_usdt, verified_at),
            )

    def mark_subscription_inactive(self, project_id: str) -> None:
        with self._lock, self._connect() as c:
            c.execute(
                "UPDATE active_copy_subscriptions SET status='INACTIVE' WHERE project_id=?",
                (project_id,),
            )

    def list_active_subscriptions(self) -> list[dict]:
        with self._connect() as c:
            rows = c.execute(
                "SELECT * FROM active_copy_subscriptions WHERE status='ACTIVE' ORDER BY verified_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]


    def latest_exchange_action(self, venue: str, project_id: str) -> dict | None:
        with self._connect() as c:
            row = c.execute(
                """SELECT * FROM exchange_action_ledger
                WHERE venue=? AND project_id=?
                ORDER BY updated_at DESC LIMIT 1""",
                (venue, project_id),
            ).fetchone()
        if not row:
            return None
        result = dict(row)
        if result.get("response_json"):
            result["response"] = json.loads(result["response_json"])
        return result
