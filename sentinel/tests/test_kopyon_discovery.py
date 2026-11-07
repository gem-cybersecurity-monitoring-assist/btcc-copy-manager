from kopyon_discovery import KopyonBitgetDiscovery, KopyonError


def test_kopyon_trader_id_is_not_assumed_to_be_native_project_id():
    def transport(path, params):
        if path == "traders":
            return {"traders": [{"traderId": "uid-123", "name": "Trader", "roi": 0.2, "aum": 1000, "winRate": 0.6, "maxDrawdown": 0.15, "copiers": 12}]}
        if path == "performance":
            return {"roi": 0.2, "winRate": 0.6, "trades": 10}
        if path == "positionHistory":
            return {"positions": [{"symbol": "BTCUSDT", "side": "LONG", "leverage": 3, "netPnl": 2, "roi": 0.1, "maxOpenInterest": 300, "openedAt": 1790000000000, "closedAt": 1790000100000}]}
        raise AssertionError(path)

    row = KopyonBitgetDiscovery("key", transport=transport).discover()[0]
    assert row.trader_id == "uid-123"
    assert row.exchange_project_id is None
    assert len(row.recent_trades) == 1
    assert row.recent_trades[0].pnl_usdt == 2
    assert row.max_drawdown_pct == 15.0


def test_explicit_mapping_is_the_only_way_to_set_native_project_id():
    def transport(path, params):
        if path == "traders":
            return {"traders": [{"traderId": "uid-123", "name": "Trader"}]}
        if path == "performance":
            return {}
        if path == "positionHistory":
            return {"positions": []}
        raise AssertionError(path)

    row = KopyonBitgetDiscovery(
        "key", project_id_map={"uid-123": "native-project-456"}, transport=transport
    ).discover()[0]
    assert row.exchange_project_id == "native-project-456"


def test_discovery_requires_api_key():
    client = KopyonBitgetDiscovery(api_key="", transport=lambda *_: {})
    try:
        client.discover()
    except KopyonError as exc:
        assert "KOPYON_API_KEY" in str(exc)
    else:
        raise AssertionError("Expected missing API key to fail")
