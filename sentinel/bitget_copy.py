from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Callable
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from models import AccountState, Provenance


class BitgetError(RuntimeError):
    pass


@dataclass(frozen=True)
class BitgetConfig:
    api_key: str
    secret_key: str
    passphrase: str
    base_url: str = "https://api.bitget.com"
    live_enabled: bool = False
    internal_transfer_enabled: bool = False
    copy_fund_source: str = ""
    allowed_project_ids: frozenset[str] = frozenset()

    @classmethod
    def from_env(cls) -> "BitgetConfig":
        return cls(
            api_key=os.getenv("BITGET_API_KEY", "").strip(),
            secret_key=os.getenv("BITGET_API_SECRET", "").strip(),
            passphrase=os.getenv("BITGET_API_PASSPHRASE", "").strip(),
            base_url=os.getenv("BITGET_API_BASE_URL", "https://api.bitget.com").rstrip("/"),
            live_enabled=os.getenv("BITGET_COPY_LIVE_ENABLED", "false").lower() == "true",
            internal_transfer_enabled=os.getenv("BITGET_COPY_INTERNAL_TRANSFER_ENABLED", "false").lower() == "true",
            copy_fund_source=os.getenv("BITGET_COPY_FUND_SOURCE", "").strip().lower(),
            allowed_project_ids=frozenset(
                x.strip() for x in os.getenv("BITGET_COPY_ALLOWED_PROJECT_IDS", "").split(",") if x.strip()
            ),
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.secret_key and self.passphrase)


def _canonical_query(params: dict[str, Any] | None) -> str:
    if not params:
        return ""
    return urlencode(sorted((k, str(v)) for k, v in params.items() if v is not None))


def make_signature(secret: str, timestamp: str, method: str, request_path: str, body: str = "") -> str:
    message = f"{timestamp}{method.upper()}{request_path}{body}"
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


class BitgetCopyAdapter:
    """Bitget v3 futures-copy follower API. Mutations are opt-in and project-allowlisted.

    The injected transport makes contract tests deterministic and prevents tests
    from making network requests. No transfer or withdrawal methods are exposed.
    """

    MIN_SUBSCRIPTION_USDT = 50.0
    MAX_LEVERAGE = 10

    def __init__(
        self,
        config: BitgetConfig | None = None,
        transport: Callable[[str, str, dict[str, str], str], dict] | None = None,
    ):
        self.config = config or BitgetConfig.from_env()
        self.transport = transport or self._http_transport

    def status(self) -> dict[str, Any]:
        return {
            "exchange": "bitget",
            "configured": self.config.configured,
            "live_enabled": self.config.live_enabled,
            "internal_transfer_enabled": self.config.internal_transfer_enabled,
            "copy_fund_source": self.config.copy_fund_source or None,
            "allowlisted_project_count": len(self.config.allowed_project_ids),
            "minimum_subscription_usdt": self.MIN_SUBSCRIPTION_USDT,
            "required_account_mode": "Unified Account",
            "supported": ["account_snapshot", "current_copy", "copy_settings", "current_positions", "profit_details", "follow", "modify", "unfollow", "close_all"],
            "unsupported_by_design": ["withdraw", "address_management", "fund_transfer"],
        }

    def _http_transport(self, method: str, path_and_query: str, headers: dict[str, str], body: str) -> dict:
        request = Request(
            f"{self.config.base_url}{path_and_query}",
            data=body.encode() if method.upper() != "GET" else None,
            headers=headers,
            method=method.upper(),
        )
        try:
            with urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise BitgetError(f"Bitget HTTP {exc.code}: {detail}") from None
        except (URLError, TimeoutError) as exc:
            raise BitgetError(f"Bitget API unavailable: {type(exc).__name__}") from None
        if payload.get("code") != "00000":
            raise BitgetError(f"Bitget rejected request: {payload.get('code')} {payload.get('msg')}")
        return payload.get("data", {})

    def _request(self, method: str, path: str, params: dict[str, Any] | None = None, body_obj: dict | None = None):
        if not self.config.configured:
            raise BitgetError("Bitget API credentials are not configured.")
        query = _canonical_query(params)
        path_and_query = path + (f"?{query}" if query else "")
        body = json.dumps(body_obj, separators=(",", ":"), ensure_ascii=False) if body_obj is not None else ""
        timestamp = str(int(time.time() * 1000))
        signature = make_signature(self.config.secret_key, timestamp, method, path_and_query, body)
        headers = {
            "ACCESS-KEY": self.config.api_key,
            "ACCESS-SIGN": signature,
            "ACCESS-TIMESTAMP": timestamp,
            "ACCESS-PASSPHRASE": self.config.passphrase,
            "Content-Type": "application/json",
            "locale": "en-US",
        }
        return self.transport(method, path_and_query, headers, body)

    def _project(self, project_id: str) -> str:
        project_id = project_id.strip()
        if not project_id:
            raise BitgetError("projectId is required.")
        if project_id not in self.config.allowed_project_ids:
            raise BitgetError("projectId is not in BITGET_COPY_ALLOWED_PROJECT_IDS.")
        return project_id

    def _require_live(self):
        if not self.config.live_enabled:
            raise BitgetError("Live copy actions are disabled. Set BITGET_COPY_LIVE_ENABLED=true only after validation.")


    def account_snapshot(self, timezone_name: str | None = None) -> AccountState:
        """Read UTA equity and today's realized futures PnL for a venue-tagged snapshot."""
        now = datetime.now(timezone.utc)
        try:
            tz = ZoneInfo(timezone_name or os.getenv("SENTINEL_TIMEZONE", "Africa/Lagos"))
        except Exception:
            raise BitgetError("SENTINEL_TIMEZONE is not a valid IANA timezone.") from None
        assets = self._request("GET", "/api/v3/account/assets")
        if not isinstance(assets, dict) or not assets.get("usdtEquity"):
            raise BitgetError("Bitget account-assets response did not include USDT equity.")
        local_midnight = now.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
        start_ms = int(local_midnight.astimezone(timezone.utc).timestamp() * 1000)
        end_ms = int(now.timestamp() * 1000)
        cursor = None
        realized = 0.0
        complete = True
        for page in range(10):
            params: dict[str, Any] = {
                "category": "USDT-FUTURES",
                "startTime": start_ms,
                "endTime": end_ms,
                "limit": 100,
            }
            if cursor:
                params["cursor"] = cursor
            fills = self._request("GET", "/api/v3/trade/fills", params)
            rows = fills.get("list", []) if isinstance(fills, dict) else []
            for fill in rows:
                pnl = float(fill.get("execPnl") or 0)
                fees = sum(
                    float(fee.get("fee") or 0)
                    for fee in fill.get("feeDetail", [])
                    if fee.get("feeCoin") == "USDT"
                )
                realized += pnl - fees
            cursor = fills.get("cursor") if isinstance(fills, dict) else None
            if not cursor:
                break
        else:
            complete = False

        usdt_asset = next((row for row in assets.get("assets", []) if row.get("coin") == "USDT"), {})
        confidence = 0.99 if complete else 0.80
        usdt_available = max(0.0, float(usdt_asset.get("available") or 0))
        effective_equity = max(0.0, float(assets.get("effEquity") or 0))
        conservative_free = min(usdt_available, effective_equity)
        return AccountState(
            exchange="bitget",
            total_usdt=max(0.0, float(assets.get("usdtEquity") or 0)),
            futures_free_usdt=conservative_free,
            wallet_usdt=usdt_available,
            open_margin_usdt=max(0.0, float(assets.get("imr") or 0)),
            realized_pnl_today_usdt=realized,
            active_positions=1 if float(assets.get("positionValue") or 0) > 0 else 0,
            source_timestamp=now,
            provenance=Provenance(
                source="xhr",
                confidence=confidence,
                captured_at=now,
            ),
        )

    def current_copy(self, project_id: str):
        return self._request("GET", "/api/v3/copy/futures/current-copy", {"projectId": self._project(project_id)})

    def copy_settings(self, project_id: str):
        return self._request("GET", "/api/v3/copy/futures/copy-settings", {"projectId": self._project(project_id)})

    def current_positions(self, project_id: str):
        return self._request("GET", "/api/v3/copy/futures/current-positions", {"projectId": self._project(project_id)})

    def profit_details(self, project_id: str, start_time: int | None = None, end_time: int | None = None):
        params = {"projectId": self._project(project_id), "startTime": start_time, "endTime": end_time, "limit": 100}
        return self._request("GET", "/api/v3/copy/futures/copy-profit-details", params)

    def follow(
        self,
        project_id: str,
        amount_usdt: float,
        *,
        copy_type: str = "fixed_ratio",
        leverage: int = 3,
        auto_copy: str = "off",
        max_entry_slippage: float = 0.5,
        max_position_value: float,
        trading_pairs: list[str] | None = None,
        margin_per_order: float | None = None,
        max_margin_ratio: int = 10,
    ):
        self._require_live()
        project_id = self._project(project_id)
        if amount_usdt < self.MIN_SUBSCRIPTION_USDT:
            raise BitgetError("Bitget futures copy subscription minimum is 50 USDT.")
        if not self.config.internal_transfer_enabled:
            raise BitgetError("Bitget copy subscription may auto-transfer funds; explicit internal-transfer permission is disabled.")
        if self.config.copy_fund_source not in {"funding", "uta", "otc"}:
            raise BitgetError("Set BITGET_COPY_FUND_SOURCE to an explicitly authorized source: funding, uta or otc.")
        if copy_type not in {"fixed_ratio", "fixed_margin"}:
            raise BitgetError("Unsupported Bitget copy type.")
        if not 1 <= leverage <= self.MAX_LEVERAGE:
            raise BitgetError("Leverage must be between 1x and 10x.")
        if not 5 <= max_margin_ratio <= 95:
            raise BitgetError("Maximum single-order margin ratio must be between 5% and 95%.")
        if auto_copy != "off":
            raise BitgetError("Automatic new-pair following must remain off.")
        if max_position_value <= 0 or max_position_value > amount_usdt * leverage:
            raise BitgetError("Maximum position value must be positive and no greater than allocation multiplied by leverage.")
        if copy_type == "fixed_margin" and (margin_per_order is None or margin_per_order <= 0 or margin_per_order > amount_usdt):
            raise BitgetError("fixed_margin requires a positive per-order margin no greater than the subscription amount.")
        params: dict[str, Any] = {
            "projectId": project_id,
            "type": copy_type,
            "amount": f"{amount_usdt:.2f}",
            "accountType": self.config.copy_fund_source,
            "autoCopy": "off",
            "leverage": str(leverage),
            "maxEntrySlippage": str(max_entry_slippage),
            "maxMarginRatio": str(max_margin_ratio),
            "maxPostionValue": f"{max_position_value:.2f}",
        }
        if trading_pairs:
            params["tradingPairList"] = ",".join(sorted(set(trading_pairs)))
        if margin_per_order is not None:
            params["marginPerOrder"] = f"{margin_per_order:.2f}"
        return self._request("POST", "/api/v3/copy/futures/follower-settings", params)

    def modify(self, project_id: str, *, leverage: int, auto_copy: str = "off", max_position_value: float, max_margin_ratio: int = 10):
        self._require_live()
        project_id = self._project(project_id)
        if not 1 <= leverage <= self.MAX_LEVERAGE or auto_copy != "off" or max_position_value <= 0 or not 5 <= max_margin_ratio <= 95:
            raise BitgetError("Unsafe or invalid copy settings.")
        return self._request("POST", "/api/v3/copy/futures/modify-follower-settings", {
            "projectId": project_id,
            "leverage": str(leverage),
            "autoCopy": "off",
            "maxPostionValue": f"{max_position_value:.2f}",
            "maxMarginRatio": str(max_margin_ratio),
        })

    def unfollow(self, project_id: str, *, close_type: str = "follow_close"):
        self._require_live()
        project_id = self._project(project_id)
        if close_type not in {"follow_close", "instant_close"}:
            raise BitgetError("Unsupported closeType.")
        return self._request("POST", "/api/v3/copy/futures/unfollow", {
            "projectId": project_id,
            "closeType": close_type,
        })

    def close_all(self, project_id: str):
        self._require_live()
        return self._request("POST", "/api/v3/copy/futures/close-all", {"projectId": self._project(project_id)})
