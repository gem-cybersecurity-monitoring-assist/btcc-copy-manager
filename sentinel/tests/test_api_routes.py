def test_sentinel_api_registers_authenticated_bitget_and_scan_routes():
    import main

    paths = {route.path for route in main.app.routes}
    assert "/health" in paths
    assert "/scan" in paths
    assert "/bitget/status" in paths
    assert "/bitget/account-snapshot" in paths
    assert "/bitget/current-copy" in paths
    assert "/bitget/copy-settings" in paths
    assert "/bitget/follow" in paths
    assert "/bitget/modify" in paths
    assert "/bitget/unfollow" in paths
    assert "/bitget/close-all" in paths
