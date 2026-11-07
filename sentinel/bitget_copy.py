from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, localcontext
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



@dataclass(frozen=True)
class BitgetAccountEvidence:
    """Read-only observations, never execution-grade capital or reconciled ROI."""
    exchange_user_id: str
    equity_usdt: str
    available_usdt: str | None
    aggregate_metrics_usd: dict[str, str | None]
    positions: list[dict[str, Any]]
    position_categories: list[str]
    positions_complete: bool
    active_positions: int | None
    fills: list[dict[str, Any]]
    fill_history_complete: bool
    fill_history_status: str
    fill_history_category: str
    fill_window_start_ms: int
    fill_window_end_ms: int
    fill_pnl_usdt: str | None
    fill_fees_by_coin: dict[str, str]
    net_pnl_today_usdt: None
    net_pnl_status: str
    received_started_at: str
    received_completed_at: str
    provider_request_times_ms: dict[str, int | None]
    read_only: bool = True
    execution_eligible: bool = False


class _ResponseData(dict):
    """Keep the exchange envelope clock without changing existing data mapping."""
    def __init__(self, data: dict, request_time_ms: int | None):
        super().__init__(data)
        self.request_time_ms = request_time_ms


def _decimal_text(value: Any, name: str, *, nonnegative: bool = False) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise BitgetError(f"Bitget {name} is unavailable or invalid.")
    if len(str(value)) > 128 or (isinstance(value, str) and not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", value)):
        raise BitgetError(f"Bitget {name} is unavailable or invalid.")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise BitgetError(f"Bitget {name} is unavailable or invalid.") from None
    if not number.is_finite() or len(number.as_tuple().digits) > 38 or (number != 0 and not -28 <= number.adjusted() <= 28) or (nonnegative and number < 0):
        raise BitgetError(f"Bitget {name} is unavailable or invalid.")
    return format(number, "f")


def _optional_decimal(value: Any, name: str, *, nonnegative: bool = False) -> str | None:
    return None if value is None else _decimal_text(value, name, nonnegative=nonnegative)


def _add_amount(left: Decimal, right: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = 64
        return left + right


def _provider_time(payload: dict) -> int | None:
    value = getattr(payload, "request_time_ms", None)
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None

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
            "supported": ["account_evidence", "current_copy", "copy_settings", "current_positions", "profit_details", "follow", "modify", "unfollow", "close_all"],
            "execution_risk_snapshot_available": False,
            "unavailable": ["account_snapshot"],
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
            status = exc.code if isinstance(exc.code, int) and 100 <= exc.code <= 599 else "unknown"
            exc.close()
            raise BitgetError(f"Bitget HTTP {status}") from None
        except (URLError, TimeoutError) as exc:
            raise BitgetError(f"Bitget API unavailable: {type(exc).__name__}") from None
        except (json.JSONDecodeError, UnicodeError):
            raise BitgetError("Bitget returned an invalid response.") from None
        if not isinstance(payload, dict):
            raise BitgetError("Bitget returned an invalid response.")
        if payload.get("code") != "00000":
            code = payload.get("code")
            safe_code = code if isinstance(code, str) and re.fullmatch(r"[0-9]{5}", code) else "unknown"
            raise BitgetError(f"Bitget rejected request (code {safe_code}).")
        data = payload.get("data", {})
        if isinstance(data, dict):
            stamp = payload.get("requestTime")
            stamp = stamp if isinstance(stamp, int) and not isinstance(stamp, bool) and stamp > 0 else None
            return _ResponseData(data, stamp)
        return data

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


    def account_evidence(
        self, timezone_name: str | None = None, *, max_fill_pages: int = 2,
    ) -> BitgetAccountEvidence:
        """Bounded GET-only collection with explicit scope and completeness.

        No USD aggregate is converted to USDT, and fills are not presented as
        reconciled net account profit. Read-only uta_mgt alone remains useful
        for asset evidence; positions/fills additionally require uta_trade.
        """
        if isinstance(max_fill_pages, bool) or not isinstance(max_fill_pages, int) or not 1 <= max_fill_pages <= 10:
            raise BitgetError("max_fill_pages must be an integer between 1 and 10.")
        started = datetime.now(timezone.utc)
        try:
            tz = ZoneInfo(timezone_name or os.getenv("SENTINEL_TIMEZONE", "Africa/Lagos"))
        except Exception:
            raise BitgetError("SENTINEL_TIMEZONE is not a valid IANA timezone.") from None
        midnight = started.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
        start_ms = int(midnight.astimezone(timezone.utc).timestamp() * 1000)
        end_ms = int(started.timestamp() * 1000)
        info = self._request("GET", "/api/v3/account/info")
        permissions = info.get("permissions") if isinstance(info, dict) else None
        if (
            not isinstance(info, dict) or info.get("permType") != "read-only"
            or not isinstance(permissions, list) or not permissions
            or any(not isinstance(scope, str) for scope in permissions)
            or len(permissions) != len(set(permissions))
            or "uta_mgt" not in permissions
            or not set(permissions).issubset({"uta_mgt", "uta_trade"})
        ):
            raise BitgetError("Bitget evidence requires a read-only key with only UTA management and optionally UTA trade read scopes.")
        user_id = info.get("userId")
        if not isinstance(user_id, str) or not user_id.isdigit() or len(user_id) > 64:
            raise BitgetError("Bitget account identity is unavailable.")
        assets = self._request("GET", "/api/v3/account/assets")
        if not isinstance(assets, dict) or not isinstance(assets.get("assets"), list):
            raise BitgetError("Bitget account-assets response is invalid.")
        equity = _decimal_text(assets.get("usdtEquity"), "USDT equity", nonnegative=True)
        usdt_rows = [row for row in assets["assets"] if isinstance(row, dict) and row.get("coin") == "USDT"]
        if len(usdt_rows) > 1:
            raise BitgetError("Bitget account-assets response has duplicate USDT rows.")
        available = _optional_decimal(usdt_rows[0].get("available"), "USDT availability", nonnegative=True) if usdt_rows else None
        usd = {
            name: _optional_decimal(assets.get(name), name, nonnegative=name != "unrealisedPnl")
            for name in ("accountEquity", "effEquity", "imr", "positionValue", "unrealisedPnl")
        }
        clocks = {"account_info": _provider_time(info), "account_assets": _provider_time(assets)}
        positions: list[dict[str, Any]] = []
        completed: list[str] = []
        fills: list[dict[str, Any]] = []
        fill_status = "permission_missing"
        fill_complete = False
        fill_pnl: str | None = None
        fees: dict[str, Decimal] = {}
        if "uta_trade" in permissions:
            for category in ("USDT-FUTURES", "COIN-FUTURES", "USDC-FUTURES"):
                try:
                    payload = self._request("GET", "/api/v3/position/current-position", {"category": category})
                    if not isinstance(payload, dict) or not isinstance(payload.get("list"), list) or len(payload["list"]) > 1000:
                        raise BitgetError("Invalid positions response.")
                    category_rows = []
                    seen_positions = set()
                    for row in payload["list"]:
                        if not isinstance(row, dict) or row.get("category") != category:
                            raise BitgetError("Invalid position category.")
                        identity = (row.get("symbol"), row.get("posSide"))
                        if (not isinstance(identity[0], str) or not identity[0]
                            or identity[1] not in {"long", "short"} or identity in seen_positions
                            or not isinstance(row.get("marginCoin"), str) or not row["marginCoin"]):
                            raise BitgetError("Invalid position identity.")
                        seen_positions.add(identity)
                        total = _decimal_text(row.get("total"), "position quantity", nonnegative=True)
                        if Decimal(total) == 0:
                            continue
                        projected = {"category": category, "symbol": row["symbol"], "posSide": row["posSide"], "marginCoin": row["marginCoin"], "total": total}
                        for name in ("positionBalance", "leverage", "unrealisedPnl", "curRealisedPnl", "totalFunding", "openFeeTotal", "closeFeeTotal"):
                            projected[name] = _optional_decimal(row.get(name), name, nonnegative=name in {"positionBalance", "leverage"})
                        for name in ("createdTime", "updatedTime"):
                            stamp = row.get(name)
                            if stamp is not None and (not isinstance(stamp, str) or not stamp.isdigit()):
                                raise BitgetError("Invalid position timestamp.")
                            projected[name] = stamp
                        category_rows.append(projected)
                    positions.extend(category_rows)
                    completed.append(category)
                    clocks["positions_" + category] = _provider_time(payload)
                except BitgetError:
                    # Partial category evidence is displayed as partial, never zero.
                    clocks["positions_" + category] = None
            params: dict[str, Any] = {
                "category": "USDT-FUTURES", "startTime": start_ms,
                "endTime": end_ms, "limit": 100,
            }
            seen_ids: dict[str, dict] = {}
            seen_cursors: set[str] = set()
            fill_status = "page_limit"
            try:
                for page in range(max_fill_pages):
                    payload = self._request("GET", "/api/v3/trade/fills", params)
                    if not isinstance(payload, dict) or not isinstance(payload.get("list"), list):
                        raise BitgetError("Invalid fill response.")
                    clocks["fills_page_" + str(page + 1)] = _provider_time(payload)
                    if len(payload["list"]) > 100:
                        raise BitgetError("Invalid fill page size.")
                    for row in payload["list"]:
                        if not isinstance(row, dict) or row.get("category") != "USDT-FUTURES":
                            raise BitgetError("Invalid fill category.")
                        exec_id = row.get("execId")
                        if not isinstance(exec_id, str) or not exec_id or len(exec_id) > 160:
                            raise BitgetError("Invalid fill identity.")
                        stamp = row.get("createdTime")
                        if not isinstance(stamp, str) or not stamp.isdigit() or not params["startTime"] <= int(stamp) <= params["endTime"]:
                            raise BitgetError("Fill is outside the requested time range.")
                        pnl = _decimal_text(row.get("execPnl"), "fill PnL")
                        detail = row.get("feeDetail")
                        if not isinstance(detail, list):
                            raise BitgetError("Fill fee evidence is unavailable.")
                        fee_rows = []
                        for fee in detail:
                            if not isinstance(fee, dict) or not isinstance(fee.get("feeCoin"), str) or not fee["feeCoin"]:
                                raise BitgetError("Invalid fill fee currency.")
                            fee_rows.append({"coin": fee["feeCoin"], "amount": _decimal_text(fee.get("fee"), "fill fee")})
                        projected = {"execId": exec_id, "createdTime": stamp, "execPnl": pnl, "fees": fee_rows}
                        if exec_id in seen_ids and seen_ids[exec_id] != projected:
                            raise BitgetError("Conflicting duplicate fill evidence.")
                        seen_ids[exec_id] = projected
                    cursor = payload.get("cursor")
                    if cursor is None or cursor == "":
                        fill_complete, fill_status = True, "complete"
                        break
                    if not isinstance(cursor, str) or len(cursor) > 160 or cursor in seen_cursors:
                        raise BitgetError("Invalid or repeated fill cursor.")
                    seen_cursors.add(cursor)
                    params["cursor"] = cursor
            except BitgetError:
                fill_status = "unavailable_or_invalid"
                fill_complete = False
            fills = list(seen_ids.values())
            if fill_complete:
                total_pnl = Decimal(0)
                for row in fills:
                    total_pnl = _add_amount(total_pnl, Decimal(row["execPnl"]))
                fill_pnl = format(total_pnl, "f")
            for row in fills:
                for fee in row["fees"]:
                    fees[fee["coin"]] = _add_amount(fees.get(fee["coin"], Decimal(0)), Decimal(fee["amount"]))
        return BitgetAccountEvidence(
            exchange_user_id=user_id, equity_usdt=equity, available_usdt=available,
            aggregate_metrics_usd=usd, positions=positions, position_categories=completed,
            positions_complete=len(completed) == 3,
            active_positions=len(positions) if len(completed) == 3 else None,
            fills=fills, fill_history_complete=fill_complete, fill_history_status=fill_status,
            fill_history_category="USDT-FUTURES", fill_window_start_ms=start_ms, fill_window_end_ms=end_ms,
            fill_pnl_usdt=fill_pnl, fill_fees_by_coin={coin: format(value, "f") for coin, value in fees.items()},
            net_pnl_today_usdt=None, net_pnl_status="unreconciled_funding_cashflows_and_fee_currencies",
            received_started_at=started.isoformat(), received_completed_at=datetime.now(timezone.utc).isoformat(),
            provider_request_times_ms=clocks,
        )

    def account_snapshot(self, timezone_name: str | None = None) -> AccountState:
        """Legacy execution-risk shape cannot represent incomplete evidence safely."""
        if timezone_name:
            try:
                ZoneInfo(timezone_name)
            except Exception:
                raise BitgetError("SENTINEL_TIMEZONE is not a valid IANA timezone.") from None
        raise BitgetError(
            "Execution-grade Bitget snapshot is unavailable: USDT margin capacity and reconciled daily PnL "
            "have not been verified. Use account_evidence() for read-only observations; no execution is authorized."
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
