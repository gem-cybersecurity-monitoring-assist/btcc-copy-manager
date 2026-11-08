from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import io
import json
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request

import pytest

import observation_repository as module
from observation_repository import LedgerConfig, LedgerError, ObservationRepository, SnapshotObservation

OWNER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
CONNECTION = "33333333-3333-4333-8333-333333333333"
ROW = "44444444-4444-4444-8444-444444444444"
NOW = datetime(2026, 11, 8, 2, 0, tzinfo=timezone.utc)
PUBLIC = "synthetic-public-key"
PRIVATE = "synthetic-server-key"
TOKEN = "synthetic-owner-token"
CONFIG = LedgerConfig("https://aaaaaaaaaaaaaaaaaaaa.supabase.co", PUBLIC, PRIVATE, OWNER)


def observation(**kwargs):
    return replace(SnapshotObservation("bitget", NOW, "USDT", "official_api",
                                       "100.12345678", "40.00000001"), **kwargs)


class Fixture:
    def __init__(self):
        self.calls = []
        self.user = {"id": OWNER, "email_confirmed_at": NOW.isoformat(), "is_anonymous": False}
        self.connection = {"id": CONNECTION, "user_id": OWNER, "venue": "bitget", "connection_status": "READ_ONLY"}
        self.rows = {}
        self.status = None
        self.tamper = None

    def __call__(self, request):
        self.calls.append(request)
        path = urlparse(request.full_url).path
        query = parse_qs(urlparse(request.full_url).query)
        headers = {k.lower(): v for k, v in request.header_items()}
        if self.status:
            return self.status, {"message": PRIVATE + TOKEN}
        if path == "/auth/v1/user":
            assert headers["apikey"] == PUBLIC
            assert headers["authorization"] == "Bearer " + TOKEN
            return 200, self.user
        if path.endswith("gem_copy_connections"):
            assert headers["apikey"] == PUBLIC
            assert query["id"] == ["eq." + CONNECTION]
            assert query["user_id"] == ["eq." + OWNER]
            return 200, [self.connection] if self.connection is not None else []
        assert path.endswith("gem_copy_account_snapshots")
        if request.method == "POST":
            assert headers["apikey"] == PRIVATE
            assert headers["authorization"] == "Bearer " + PRIVATE
            assert "ignore-duplicates" in headers["prefer"]
            assert "merge-duplicates" not in headers["prefer"]
            assert query["on_conflict"] == ["user_id,connection_id,snapshot_hash"]
            row = json.loads(request.data)
            assert set(row) == {"user_id", "connection_id", "captured_at", "quote_currency",
                                "source_kind", "equity_quote", "available_quote",
                                "realized_pnl_quote", "unrealized_pnl_quote", "snapshot_hash"}
            key = row["snapshot_hash"]
            if key in self.rows:
                return 201, []
            self.rows[key] = {"id": ROW, **row}
            return 201, [{**self.rows[key], **(self.tamper or {})}]
        assert request.method == "GET"
        assert headers["apikey"] == PUBLIC
        assert query["user_id"] == ["eq." + OWNER]
        assert query["connection_id"] == ["eq." + CONNECTION]
        key = query["snapshot_hash"][0][3:]
        row = self.rows.get(key)
        return 200, [row] if row else []


def repository(fixture):
    return ObservationRepository(CONFIG, fixture, lambda: NOW)


def test_restart_retries_do_not_overwrite_or_duplicate_observations():
    f = Fixture()
    first = repository(f).save_snapshot(TOKEN, CONNECTION, observation())
    again = repository(f).save_snapshot(TOKEN, CONNECTION, observation())
    assert first["inserted"] is True and again["inserted"] is False
    assert first["snapshot_hash"] == again["snapshot_hash"]
    assert len(f.rows) == 1
    assert [urlparse(r.full_url).path for r in f.calls].count("/auth/v1/user") == 2
    assert all(r.method in {"GET", "POST"} for r in f.calls)
    row = next(iter(f.rows.values()))
    assert row["realized_pnl_quote"] is None
    assert row["unrealized_pnl_quote"] is None
    assert row["equity_quote"] == "100.12345678"


@pytest.mark.parametrize("user", [
    {"id": OTHER, "email_confirmed_at": "confirmed"},
    {"id": OWNER, "email_confirmed_at": None},
    {"id": OWNER, "email_confirmed_at": "confirmed", "is_anonymous": True},
    {}, [], None,
])
def test_unverified_ordinary_or_anonymous_identity_never_reaches_ledger(user):
    f = Fixture()
    f.user = user
    with pytest.raises(LedgerError, match="confirmed owner"):
        repository(f).save_snapshot(TOKEN, CONNECTION, observation())
    assert len(f.calls) == 1
    assert not f.rows


@pytest.mark.parametrize("connection", [
    None, {}, {"id": CONNECTION, "user_id": OTHER}, "malformed",
    {"id": CONNECTION, "user_id": OWNER, "venue": "btcc", "connection_status": "VERIFIED"},
    {"id": CONNECTION, "user_id": OWNER, "venue": "bitget", "connection_status": "PAUSED"},
])
def test_connection_must_belong_to_owner_and_match_verified_venue(connection):
    f = Fixture()
    f.connection = connection
    with pytest.raises(LedgerError, match="matching verified owner connection"):
        repository(f).save_snapshot(TOKEN, CONNECTION, observation())
    assert len(f.calls) == 2 and not f.rows


@pytest.mark.parametrize("value", [float("nan"), True, 10.1, "NaN", "Infinity", "-1",
                                  "1e20", "1e999999999", "0.000000001", "x", "1" * 101, None])
def test_invalid_or_missing_equity_fails_before_any_network(value):
    f = Fixture()
    with pytest.raises(LedgerError):
        repository(f).save_snapshot(TOKEN, CONNECTION, observation(equity_quote=value))
    assert not f.calls


@pytest.mark.parametrize("changes", [
    {"captured_at": NOW - timedelta(seconds=301)},
    {"captured_at": NOW + timedelta(seconds=61)},
    {"captured_at": NOW.replace(tzinfo=None)},
    {"quote_currency": "BTC"}, {"source_kind": "simulation"}, {"venue": "invented"},
])
def test_stale_unknown_or_mislabeled_evidence_fails_before_network(changes):
    f = Fixture()
    with pytest.raises(LedgerError):
        repository(f).save_snapshot(TOKEN, CONNECTION, observation(**changes))
    assert not f.calls


@pytest.mark.parametrize("status", [401, 403, 409, 429, 500, 503])
def test_auth_failure_is_sanitized_and_never_uses_privileged_key(status):
    f = Fixture()
    f.status = status
    with pytest.raises(LedgerError) as exc:
        repository(f).save_snapshot(TOKEN, CONNECTION, observation())
    assert PRIVATE not in str(exc.value) and TOKEN not in str(exc.value)
    assert len(f.calls) == 1 and not f.rows


def test_write_outage_does_not_report_success_or_retry_ambiguous_write():
    f = Fixture()
    def transport(request):
        if request.method == "POST":
            f.calls.append(request)
            raise URLError(PRIVATE + TOKEN)
        return f(request)
    with pytest.raises(LedgerError, match="unavailable") as exc:
        ObservationRepository(CONFIG, transport, lambda: NOW).save_snapshot(TOKEN, CONNECTION, observation())
    assert PRIVATE not in str(exc.value) and TOKEN not in str(exc.value)
    assert sum(r.method == "POST" for r in f.calls) == 1


@pytest.mark.parametrize("tamper", [{"user_id": OTHER}, {"connection_id": OTHER},
                                  {"equity_quote": "999"}, {"snapshot_hash": "x" * 64},
                                  {"source_kind": "manual_attestation"}, {"captured_at": "invalid"}])
def test_write_representation_must_match_exact_owner_and_observation(tamper):
    f = Fixture()
    f.tamper = tamper
    with pytest.raises(LedgerError, match="could not be verified"):
        repository(f).save_snapshot(TOKEN, CONNECTION, observation())


def test_equivalent_decimal_and_timezone_forms_have_same_identity():
    f = Fixture()
    a = repository(f).save_snapshot(TOKEN, CONNECTION, observation(equity_quote="100.1"))
    b = repository(f).save_snapshot(TOKEN, CONNECTION, observation(
        equity_quote=Decimal("100.10000000"),
        captured_at=NOW.astimezone(timezone(timedelta(hours=1)))))
    assert a["snapshot_hash"] == b["snapshot_hash"]
    assert len(f.rows) == 1
    assert observation(equity_quote="-0").payload()["equity_quote"] == "0.00000000"


def test_missing_configuration_never_falls_back_to_old_database(monkeypatch):
    for name in ("SENTINEL_LEDGER_SUPABASE_URL", "SENTINEL_LEDGER_PUBLIC_KEY",
                 "SENTINEL_LEDGER_SERVICE_ROLE_KEY", "COPY_CENTER_OWNER_USER_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SUPABASE_URL", CONFIG.url)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", PRIVATE)
    assert LedgerConfig.from_env() is None
    for url in ("http://aaaaaaaaaaaaaaaaaaaa.supabase.co", "https://evil.example",
                CONFIG.url + "/path", CONFIG.url + "@evil.example"):
        with pytest.raises(LedgerError):
            LedgerConfig(url, PUBLIC, PRIVATE, OWNER)
    assert PRIVATE not in repr(CONFIG) and PUBLIC not in repr(CONFIG)
    assert not hasattr(repository(Fixture()), "approve")
    assert not hasattr(repository(Fixture()), "execute")


def test_http_errors_do_not_read_or_reflect_upstream_bodies(monkeypatch):
    class Body(io.BytesIO):
        def read(self, *args):
            raise AssertionError("Error body must not be read")
    class Opener:
        def open(self, *args, **kwargs):
            raise HTTPError(CONFIG.url, 429, PRIVATE, {}, Body())
    monkeypatch.setattr(module, "build_opener", lambda *args: Opener())
    assert module._http(Request(CONFIG.url)) == (429, None)
    assert module._NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.example") is None


def test_http_json_keeps_decimal_precision(monkeypatch):
    class Response(io.BytesIO):
        status = 200
        def __enter__(self): return self
        def __exit__(self, *args): self.close()
    class Opener:
        def open(self, *args, **kwargs):
            return Response(b'{"amount":9999999999999999999.12345678}')
    monkeypatch.setattr(module, "build_opener", lambda *args: Opener())
    status, data = module._http(Request(CONFIG.url))
    assert status == 200
    assert data["amount"] == Decimal("9999999999999999999.12345678")


def evidence(**changes):
    from bitget_copy import BitgetAccountEvidence
    return replace(BitgetAccountEvidence(
        exchange_user_id="123456", equity_usdt="95.25", available_usdt=None,
        aggregate_metrics_usd={"accountEquity": "9999", "unrealisedPnl": "-999"},
        positions=[], position_categories=[], positions_complete=False, active_positions=None,
        fills=[], fill_history_complete=False, fill_history_status="permission_missing",
        fill_history_category="USDT-FUTURES", fill_window_start_ms=0, fill_window_end_ms=1,
        fill_pnl_usdt="777", fill_fees_by_coin={}, net_pnl_today_usdt=None,
        net_pnl_status="unreconciled_funding_cashflows_and_fee_currencies",
        received_started_at=NOW.isoformat(), received_completed_at=NOW.isoformat(),
        provider_request_times_ms={"account_assets": int(NOW.timestamp() * 1000)}), **changes)


def test_bitget_mapping_uses_provider_clock_usdt_equity_and_unknown_pnl():
    data = SnapshotObservation.from_bitget(evidence())
    assert data.captured_at == NOW
    assert data.payload()["equity_quote"] == "95.25000000"
    assert data.payload()["available_quote"] is None
    assert data.payload()["realized_pnl_quote"] is None
    assert data.payload()["unrealized_pnl_quote"] is None
    assert data.quote_currency == "USDT" and data.source_kind == "official_api"
    assert repository(Fixture()).save_snapshot(TOKEN, CONNECTION, data)["inserted"] is True


@pytest.mark.parametrize("stamp", [None, 0, -1, True, "1234", 10**30])
def test_missing_or_invalid_provider_time_never_becomes_local_receipt_time(stamp):
    with pytest.raises(LedgerError, match="provider observation timestamp"):
        SnapshotObservation.from_bitget(evidence(provider_request_times_ms={"account_assets": stamp}))


@pytest.mark.parametrize("changes", [{"read_only": False}, {"execution_eligible": True}])
def test_execution_evidence_cannot_be_presented_as_read_only(changes):
    with pytest.raises(LedgerError, match="read-only"):
        SnapshotObservation.from_bitget(evidence(**changes))
