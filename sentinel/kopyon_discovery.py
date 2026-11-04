from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from models import Provenance, TradeRecord, TraderSnapshot


class KopyonError(RuntimeError):
    pass


class KopyonBitgetDiscovery:
    """Read-only Bitget public trader discovery through Kopyon's documented API.

    Kopyon's traderId is NOT assumed to be Bitget's follower projectId.
    Execution mapping is accepted only from an explicit owner-supplied JSON map.
    """

    BASE_URL = "https://api.kopyon.com/v5/bitget-copy-trading"

    def __init__(
        self,
        api_key: str | None = None,
        project_id_map: dict[str, str] | None = None,
        transport: Callable[[str, dict[str, str]], dict] | None = None,
    ):
        self.api_key = (api_key if api_key is not None else os.getenv("KOPYON_API_KEY", "")).strip()
        raw_map = os.getenv("BITGET_COPY_PROJECT_ID_MAP", "{}")
        try:
            configured_map = json.loads(raw_map) if project_id_map is None else project_id_map
        except json.JSONDecodeError:
            raise KopyonError("BITGET_COPY_PROJECT_ID_MAP must be valid JSON.") from None
        if not isinstance(configured_map, dict) or any(
            not isinstance(k, str) or not isinstance(v, str) or not k.strip() or not v.strip()
            for k, v in configured_map.items()
        ):
            raise KopyonError("Project ID mapping must be a JSON object of non-empty string IDs.")
        self.project_id_map = {k.strip(): v.strip() for k, v in configured_map.items()}
        self.transport = transport or self._http_get

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _http_get(self, path: str, params: dict[str, str]) -> dict:
        query = urlencode(params)
        request = Request(
            f"{self.BASE_URL}/{path}?{query}",
            headers={"X-API-KEY": self.api_key, "Accept": "application/json"},
            method="GET",
        )
        try:
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:400]
            raise KopyonError(f"Kopyon HTTP {exc.code}: {detail}") from None
        except (URLError, TimeoutError) as exc:
            raise KopyonError(f"Kopyon API unavailable: {type(exc).__name__}") from None
        if not isinstance(payload, dict) or payload.get("error"):
            raise KopyonError("Kopyon returned an invalid or error response.")
        return payload.get("data") or {}

    def _get(self, path: str, params: dict[str, str]) -> dict:
        if not self.configured:
            raise KopyonError("KOPYON_API_KEY is not configured.")
        return self.transport(path, params)

    @staticmethod
    def _dt(value: Any) -> datetime | None:
        if value in (None, "", 0):
            return None
        try:
            return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc)
        except (TypeError, ValueError, OverflowError):
            return None

    def discover(
        self,
        *,
        period: str = "30D",
        sort_by: str = "pnl",
        max_candidates: int = 8,
    ) -> list[TraderSnapshot]:
        if period != "30D":
            raise KopyonError("Unsupported Kopyon performance period.")
        if sort_by not in {"pnl", "roi", "aum", "copierPnl"}:
            raise KopyonError("Unsupported Kopyon ranking sort.")
        if not 1 <= max_candidates <= 8:
            raise KopyonError("max_candidates must be between 1 and 8.")
        ranking = self._get("traders", {
            "period": period, "sortBy": sort_by, "page": "1", "rows": str(max_candidates),
        })
        leaders = ranking.get("traders") or []
        captured_at = datetime.now(timezone.utc)
        snapshots: list[TraderSnapshot] = []
        for leader in leaders[:max_candidates]:
            source_id = str(leader.get("traderId") or "").strip()
            name = str(leader.get("name") or "").strip()
            if not source_id or not name:
                continue
            performance = self._get("performance", {"traderId": source_id, "period": period})
            history = self._get("positionHistory", {"traderId": source_id, "rows": "20"})
            positions = history.get("positions") or []
            trades: list[TradeRecord] = []
            for item in positions[:20]:
                leverage = float(item.get("leverage") or 0)
                net_pnl = item.get("netPnl")
                roi = item.get("roi")
                if net_pnl is None or leverage <= 0 or roi is None:
                    continue
                trades.append(TradeRecord(
                    symbol=str(item.get("symbol") or "UNKNOWN"),
                    direction=str(item.get("side") or "UNKNOWN").lower(),
                    leverage=leverage,
                    margin_usdt=0.0,
                    pnl_usdt=float(net_pnl),
                    pnl_ratio_pct=float(roi) * 100.0,
                    opened_at=self._dt(item.get("openedAt")),
                    closed_at=self._dt(item.get("closedAt")),
                    close_reason=None,
                    provenance=Provenance(
                        source="xhr", confidence=0.97, captured_at=captured_at,
                    ),
                ))
            roi_value = performance.get("roi", leader.get("roi"))
            win_rate = performance.get("winRate", leader.get("winRate"))
            snapshots.append(TraderSnapshot(
                name=name,
                trader_id=source_id,
                exchange="bitget",
                # Kopyon traderId is deliberately NOT copied into projectId.
                exchange_project_id=self.project_id_map.get(source_id),
                pnl_30d_pct=float(roi_value) * 100.0 if roi_value is not None else None,
                aum_usdt=float(leader["aum"]) if leader.get("aum") is not None else None,
                win_rate_pct=float(win_rate) * 100.0 if win_rate is not None else None,
                copiers=int(leader["copiers"]) if leader.get("copiers") is not None else None,
                recent_trades=trades,
                executable_min_margin_usdt=50.0,
                source_timestamp=captured_at,
                provenance=Provenance(
                    source="xhr", confidence=0.97,
                    page_url=f"{self.BASE_URL}/traders",
                    captured_at=captured_at,
                ),
            ))
        return snapshots
