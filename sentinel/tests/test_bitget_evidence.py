from dataclasses import asdict
from decimal import Decimal
from urllib.parse import parse_qs, urlsplit
import json

import pytest

from bitget_copy import BitgetConfig, BitgetCopyAdapter, BitgetError

CONFIG = BitgetConfig("test-api-key", "test-api-secret", "test-passphrase")
CATEGORIES = ("USDT-FUTURES", "COIN-FUTURES", "USDC-FUTURES")


def position(category="USDT-FUTURES", symbol="BTCUSDT", coin="USDT"):
    return {"category": category, "symbol": symbol, "marginCoin": coin,
            "posSide": "long", "total": "2", "positionBalance": "12.5",
            "leverage": "3", "unrealisedPnl": "-1.25", "updatedTime": "1794050000000"}


def fill(query, identity="1", pnl="2.1", fees=None):
    return {"category": "USDT-FUTURES", "execId": identity, "createdTime": query["endTime"][0],
            "execPnl": pnl, "feeDetail": fees if fees is not None else [
                {"feeCoin": "USDT", "fee": "0.01"}, {"feeCoin": "BGB", "fee": "0.02"}]}


class Transport:
    def __init__(self, scopes=None, assets=None, positions=None, fill_pages=None):
        self.scopes = scopes if scopes is not None else ["uta_mgt", "uta_trade"]
        self.assets = assets if assets is not None else {
            "usdtEquity": "95.25", "accountEquity": "94.75", "effEquity": "80.5",
            "imr": "40.5", "positionValue": "500.1", "unrealisedPnl": "-2.25",
            "assets": [{"coin": "USDT", "available": "51.75"}],
        }
        self.positions = positions if positions is not None else {
            "USDT-FUTURES": [position(), position(symbol="ETHUSDT")],
            "COIN-FUTURES": [position("COIN-FUTURES", "BTCUSD", "BTC")],
            "USDC-FUTURES": [],
        }
        self.fill_pages = fill_pages
        self.calls = []

    def __call__(self, method, path, headers, body):
        self.calls.append((method, path))
        assert method == "GET" and body == ""
        parts = urlsplit(path)
        query = parse_qs(parts.query)
        if parts.path == "/api/v3/account/info":
            return {"userId": "123456789", "permType": "read-only", "permissions": self.scopes}
        if parts.path == "/api/v3/account/assets":
            return self.assets
        if parts.path == "/api/v3/position/current-position":
            value = self.positions[query["category"][0]]
            if isinstance(value, Exception):
                raise value
            return {"list": value}
        if parts.path == "/api/v3/trade/fills":
            if self.fill_pages is not None:
                return self.fill_pages(query)
            return {"list": [fill(query)], "cursor": ""}
        raise AssertionError("Unexpected endpoint " + path)


def test_evidence_keeps_usd_usdt_separate_and_counts_actual_positions():
    transport = Transport()
    result = BitgetCopyAdapter(CONFIG, transport).account_evidence("Africa/Lagos")
    assert result.equity_usdt == "95.25"
    assert result.available_usdt == "51.75"
    assert result.aggregate_metrics_usd["imr"] == "40.5"
    assert result.aggregate_metrics_usd["effEquity"] == "80.5"
    assert result.active_positions == 3
    assert result.positions_complete is True
    assert result.position_categories == list(CATEGORIES)
    assert {row["marginCoin"] for row in result.positions} == {"USDT", "BTC"}
    assert result.fill_pnl_usdt == "2.1"
    assert result.fill_fees_by_coin == {"USDT": "0.01", "BGB": "0.02"}
    assert result.net_pnl_today_usdt is None
    assert "unreconciled" in result.net_pnl_status
    assert result.execution_eligible is False
    assert len(transport.calls) == 6
    serialized = json.dumps(asdict(result))
    assert all(secret not in serialized for secret in (CONFIG.api_key, CONFIG.secret_key, CONFIG.passphrase))
    assert "futures_free_usdt" not in serialized and "open_margin_usdt" not in serialized


def test_assets_only_scope_never_attempts_trade_endpoints_or_fakes_position_zero():
    transport = Transport(scopes=["uta_mgt"])
    result = BitgetCopyAdapter(CONFIG, transport).account_evidence()
    assert len(transport.calls) == 2
    assert result.active_positions is None
    assert result.positions_complete is False
    assert result.fill_history_status == "permission_missing"
    assert result.fill_pnl_usdt is None


@pytest.mark.parametrize("scopes", [["uta_mgt", "withdraw"], ["uta_mgt", "copy_futures_order"], ["uta_trade"], ["uta_mgt", "uta_mgt"], ["uta_mgt", 123]])
def test_non_minimal_or_invalid_scopes_fail_before_account_assets(scopes):
    transport = Transport(scopes=scopes)
    with pytest.raises(BitgetError, match="read-only key"):
        BitgetCopyAdapter(CONFIG, transport).account_evidence()
    assert len(transport.calls) == 1


def test_write_key_is_rejected_even_with_only_read_capable_scope():
    def transport(method, path, headers, body):
        return {"userId": "123", "permType": "read-and-write", "permissions": ["uta_mgt"]}
    with pytest.raises(BitgetError, match="read-only key"):
        BitgetCopyAdapter(CONFIG, transport).account_evidence()


def test_partial_positions_remain_partial_not_zero():
    transport = Transport(positions={"USDT-FUTURES": [position()], "COIN-FUTURES": BitgetError("permission denied"), "USDC-FUTURES": []})
    result = BitgetCopyAdapter(CONFIG, transport).account_evidence()
    assert len(result.positions) == 1
    assert result.active_positions is None
    assert result.positions_complete is False


def test_complete_empty_position_lists_can_report_zero():
    result = BitgetCopyAdapter(CONFIG, Transport(positions={c: [] for c in CATEGORIES})).account_evidence()
    assert result.positions_complete is True and result.active_positions == 0


def test_duplicate_fills_are_deduplicated_without_converting_fee_coins():
    def pages(query):
        if "cursor" not in query:
            return {"list": [fill(query)], "cursor": "next"}
        return {"list": [fill(query), fill(query, "2", "-0.1")], "cursor": ""}
    result = BitgetCopyAdapter(CONFIG, Transport(fill_pages=pages)).account_evidence()
    assert result.fill_history_complete is True
    assert len(result.fills) == 2
    assert Decimal(result.fill_pnl_usdt) == Decimal("2.0")
    assert result.fill_fees_by_coin == {"USDT": "0.02", "BGB": "0.04"}
    assert result.net_pnl_today_usdt is None


def test_page_limit_marks_history_incomplete_and_never_publishes_total_pnl():
    transport = Transport(fill_pages=lambda query: {"list": [fill(query)], "cursor": "next"})
    result = BitgetCopyAdapter(CONFIG, transport).account_evidence(max_fill_pages=1)
    assert result.fill_history_status == "page_limit"
    assert result.fill_history_complete is False
    assert result.fill_pnl_usdt is None
    assert len(transport.calls) == 6


def test_repeated_cursor_stops_collection_and_marks_incomplete():
    transport = Transport(fill_pages=lambda query: {"list": [fill(query)], "cursor": "same"})
    result = BitgetCopyAdapter(CONFIG, transport).account_evidence(max_fill_pages=10)
    assert result.fill_history_status == "unavailable_or_invalid"
    assert result.fill_history_complete is False
    assert result.fill_pnl_usdt is None
    assert len(transport.calls) == 7


def test_conflicting_duplicate_fill_marks_pnl_unavailable():
    def pages(query):
        return {"list": [fill(query), fill(query, pnl="9")], "cursor": ""}
    result = BitgetCopyAdapter(CONFIG, Transport(fill_pages=pages)).account_evidence()
    assert result.fill_history_complete is False and result.fill_pnl_usdt is None


@pytest.mark.parametrize("value", ["NaN", "Infinity", "", " ", True, None, "1e10000000", "1_000"])
def test_nonfinite_or_missing_equity_fails_closed(value):
    transport = Transport()
    transport.assets["usdtEquity"] = value
    with pytest.raises(BitgetError, match="USDT equity"):
        BitgetCopyAdapter(CONFIG, transport).account_evidence()


def test_missing_usdt_row_is_unknown_availability_not_zero():
    transport = Transport()
    transport.assets["assets"] = []
    result = BitgetCopyAdapter(CONFIG, transport).account_evidence()
    assert result.available_usdt is None


def test_missing_fees_or_out_of_window_fill_is_not_complete():
    def pages(query):
        row = fill(query)
        row["createdTime"] = "1"
        row.pop("feeDetail")
        return {"list": [row], "cursor": ""}
    result = BitgetCopyAdapter(CONFIG, Transport(fill_pages=pages)).account_evidence()
    assert result.fill_history_complete is False and result.fill_pnl_usdt is None


@pytest.mark.parametrize("limit", [0, 11, True, 1.5])
def test_unbounded_or_invalid_page_limit_is_rejected_before_requests(limit):
    transport = Transport()
    with pytest.raises(BitgetError, match="max_fill_pages"):
        BitgetCopyAdapter(CONFIG, transport).account_evidence(max_fill_pages=limit)
    assert transport.calls == []


def test_legacy_execution_snapshot_fails_closed_without_http():
    transport = Transport()
    with pytest.raises(BitgetError, match="Execution-grade Bitget snapshot is unavailable"):
        BitgetCopyAdapter(CONFIG, transport).account_snapshot()
    assert transport.calls == []


def test_http_envelope_clock_is_retained_separately(monkeypatch):
    import bitget_copy
    class Reply:
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def read(self): return b'{"code":"00000","requestTime":1794050000123,"data":{"available":"1"}}'
    monkeypatch.setattr(bitget_copy, "urlopen", lambda *_args, **_kwargs: Reply())
    adapter = BitgetCopyAdapter(CONFIG)
    payload = adapter._request("GET", "/api/v3/account/assets")
    assert payload == {"available": "1"}
    assert payload.request_time_ms == 1794050000123
