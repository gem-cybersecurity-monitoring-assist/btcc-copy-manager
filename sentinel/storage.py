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
