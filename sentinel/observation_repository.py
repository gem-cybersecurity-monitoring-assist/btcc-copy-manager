"""Owner-verified observation persistence only; no approvals or exchange execution."""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID


class LedgerError(RuntimeError):
    """Fixed safe errors: never include tokens, upstream bodies or account details."""


def _uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise LedgerError("Invalid ledger identifier.") from None


def _time(value: datetime) -> str:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise LedgerError("Observation time must include a timezone.")
    return value.astimezone(timezone.utc).isoformat()


def _amount(value: str | Decimal | None, nonnegative: bool = False) -> str | None:
    if value is None:
        return None
    # No binary floats, booleans, rounding, NaN or infinities in financial evidence.
    if not isinstance(value, (str, Decimal)) or len(str(value)) > 100:
        raise LedgerError("Invalid observation amount.")
    try:
        number = Decimal(value)
        if not number.is_finite() or number.copy_abs() >= Decimal("1e20") or (nonnegative and number < 0):
            raise InvalidOperation
        if number == 0:
            number = Decimal(0)
        with localcontext() as context:
            context.prec = 40
            fixed = number.quantize(Decimal("0.00000001"))
            if fixed != number:
                raise InvalidOperation
    except (InvalidOperation, ValueError):
        raise LedgerError("Invalid observation amount.") from None
    return format(fixed, "f")


@dataclass(frozen=True, repr=False)
class LedgerConfig:
    url: str
    public_key: str = field(repr=False)
    service_role_key: str = field(repr=False)
    owner_user_id: str
    max_age_seconds: int = 300

    def __post_init__(self):
        if not re.fullmatch(r"https://[a-z0-9]{20}\.supabase\.co", self.url):
            raise LedgerError("A dedicated HTTPS Supabase project is required.")
        _uuid(self.owner_user_id)
        if (not isinstance(self.max_age_seconds, int) or isinstance(self.max_age_seconds, bool)
                or not 30 <= self.max_age_seconds <= 3600):
            raise LedgerError("Observation freshness must be between 30 and 3600 seconds.")
        if (not self.public_key or not self.service_role_key
                or self.public_key == self.service_role_key
                or any(c.isspace() for c in self.public_key + self.service_role_key)):
            raise LedgerError("Separate public and server ledger credentials are required.")

    @classmethod
    def from_env(cls) -> LedgerConfig | None:
        # Explicit opt-in: never silently use the legacy application's database.
        names = ("SENTINEL_LEDGER_SUPABASE_URL", "SENTINEL_LEDGER_PUBLIC_KEY",
                 "SENTINEL_LEDGER_SERVICE_ROLE_KEY", "COPY_CENTER_OWNER_USER_ID")
        values = [os.getenv(name, "").strip() for name in names]
        return cls(*values) if all(values) else None


@dataclass(frozen=True)
class SnapshotObservation:
    venue: str
    captured_at: datetime
    quote_currency: str
    source_kind: str
    equity_quote: str | Decimal | None
    available_quote: str | Decimal | None = None
    realized_pnl_quote: str | Decimal | None = None
    unrealized_pnl_quote: str | Decimal | None = None

    def payload(self) -> dict:
        if self.venue not in {"bitget", "btcc", "gate", "mt5", "other"}:
            raise LedgerError("Unsupported observation venue.")
        if self.quote_currency not in {"USDT", "USD", "USDC", "EUR"}:
            raise LedgerError("Unsupported observation currency.")
        if self.source_kind not in {"official_api", "manual_attestation"}:
            raise LedgerError("Observation source must be explicit.")
        if self.equity_quote is None:
            raise LedgerError("Observation equity is unavailable.")
        return {
            "captured_at": _time(self.captured_at), "quote_currency": self.quote_currency,
            "source_kind": self.source_kind,
            "equity_quote": _amount(self.equity_quote, True),
            "available_quote": _amount(self.available_quote, True),
            "realized_pnl_quote": _amount(self.realized_pnl_quote),
            "unrealized_pnl_quote": _amount(self.unrealized_pnl_quote),
        }

    @classmethod
    def from_bitget(cls, evidence) -> SnapshotObservation:
        from bitget_copy import BitgetAccountEvidence
        if not isinstance(evidence, BitgetAccountEvidence) or not evidence.read_only or evidence.execution_eligible:
            raise LedgerError("Verified read-only Bitget evidence is required.")
        stamp = evidence.provider_request_times_ms.get("account_assets")
        if isinstance(stamp, bool) or not isinstance(stamp, int) or stamp <= 0:
            raise LedgerError("The provider observation timestamp is unavailable.")
        try:
            captured = datetime.fromtimestamp(stamp / 1000, timezone.utc)
        except (ValueError, OverflowError, OSError):
            raise LedgerError("The provider observation timestamp is invalid.") from None
        # Aggregate USD metrics are not USDT equity. Fill PnL is not reconciled
        # account PnL; preserve those fields as unknown, never fabricate zeros.
        result = cls("bitget", captured, "USDT", "official_api",
                     evidence.equity_usdt, evidence.available_usdt)
        result.payload()
        return result


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _http(request: Request) -> tuple[int, object]:
    try:
        with build_opener(_NoRedirect()).open(request, timeout=15) as response:
            raw = response.read(65537)
            if len(raw) > 65536:
                raise LedgerError("Ledger response exceeded the size limit.")
            return response.status, json.loads(raw, parse_float=Decimal)
    except HTTPError as error:
        code = error.code
        error.close()
        return code, None
    except (URLError, TimeoutError, OSError, ValueError):
        raise LedgerError("The ledger service is unavailable.") from None


class ObservationRepository:
    """Not an EventStore replacement: deliberately cannot approve or execute."""

    def __init__(self, config: LedgerConfig,
                 transport: Callable[[Request], tuple[int, object]] = _http,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self._config = config
        self._transport = transport
        self._clock = clock

    def _call(self, path: str, token: str, *, privileged: bool = False,
              body: dict | None = None) -> object:
        key = self._config.service_role_key if privileged else self._config.public_key
        headers = {"apikey": key, "Authorization": "Bearer " + token,
                   "Accept": "application/json", "Cache-Control": "no-store"}
        if body is not None:
            headers.update({"Content-Type": "application/json",
                            "Prefer": "resolution=ignore-duplicates,return=representation"})
        request = Request(self._config.url + path, headers=headers,
                          method="POST" if body is not None else "GET",
                          data=json.dumps(body, separators=(",", ":")).encode() if body is not None else None)
        try:
            status, result = self._transport(request)
        except Exception:
            raise LedgerError("The ledger service is unavailable.") from None
        if not isinstance(status, int) or isinstance(status, bool) or not 200 <= status < 300:
            raise LedgerError("The ledger request was refused or unavailable.")
        return result

    def save_snapshot(self, owner_access_token: str, connection_id: str,
                      observation: SnapshotObservation) -> dict:
        connection = _uuid(connection_id)
        if not isinstance(observation, SnapshotObservation):
            raise LedgerError("Typed observation evidence is required.")
        payload = observation.payload()
        now = self._clock()
        _time(now)
        if not -timedelta(seconds=60) <= now - observation.captured_at <= timedelta(seconds=self._config.max_age_seconds):
            raise LedgerError("Observation data is stale or future-dated.")
        if (not isinstance(owner_access_token, str) or not 8 <= len(owner_access_token) <= 8192
                or any(c.isspace() for c in owner_access_token)):
            raise LedgerError("An authenticated owner session is required.")
        # Validate on the Auth server for EVERY write, not local JWT claims or
        # user-editable metadata. Service credentials never validate the user.
        user = self._call("/auth/v1/user", owner_access_token)
        if (not isinstance(user, dict) or user.get("id") != _uuid(self._config.owner_user_id)
                or not user.get("email_confirmed_at") or user.get("is_anonymous") is True):
            raise LedgerError("A confirmed owner session is required.")
        owner = _uuid(self._config.owner_user_id)
        params = urlencode({"id": "eq." + connection, "user_id": "eq." + owner,
                            "select": "id,user_id,venue,connection_status", "limit": "2"})
        # Use owner JWT and RLS for lookup; never create a connection implicitly.
        rows = self._call("/rest/v1/gem_copy_connections?" + params, owner_access_token)
        if (not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict) or rows[0].get("id") != connection
                or rows[0].get("user_id") != owner or rows[0].get("venue") != observation.venue
                or rows[0].get("connection_status") not in {"READ_ONLY", "VERIFIED"}):
            raise LedgerError("A matching verified owner connection is required.")
        payload.update({"user_id": owner, "connection_id": connection})
        digest_input = {**payload, "venue": observation.venue}
        payload["snapshot_hash"] = hashlib.sha256(
            json.dumps(digest_input, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        params = urlencode({"on_conflict": "user_id,connection_id,snapshot_hash"})
        stored = self._call("/rest/v1/gem_copy_account_snapshots?" + params,
                            self._config.service_role_key, privileged=True, body=payload)
        inserted = isinstance(stored, list) and len(stored) == 1
        if stored == []:
            params = urlencode({"user_id": "eq." + owner, "connection_id": "eq." + connection,
                                "snapshot_hash": "eq." + payload["snapshot_hash"], "limit": "2"})
            stored = self._call("/rest/v1/gem_copy_account_snapshots?" + params, owner_access_token)
        if not isinstance(stored, list) or len(stored) != 1 or not self._matches(stored[0], payload):
            raise LedgerError("The persisted observation could not be verified.")
        return {"id": _uuid(stored[0].get("id")), "inserted": inserted,
                "snapshot_hash": payload["snapshot_hash"]}

    @staticmethod
    def _matches(row: object, expected: dict) -> bool:
        if not isinstance(row, dict):
            return False
        try:
            for key, value in expected.items():
                actual = row.get(key)
                if key.endswith("_quote"):
                    if _amount(Decimal(str(actual)) if actual is not None else None) != value:
                        return False
                elif key == "captured_at":
                    if _time(datetime.fromisoformat(str(actual).replace("Z", "+00:00"))) != value:
                        return False
                elif actual != value:
                    return False
            return True
        except (LedgerError, InvalidOperation, ValueError, TypeError):
            return False
