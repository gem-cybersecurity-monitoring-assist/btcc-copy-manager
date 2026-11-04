from bitget_copy import BitgetConfig, BitgetCopyAdapter, BitgetError, make_signature


def fake_transport(calls):
    def send(method, path, headers, body):
        calls.append((method, path, headers, body))
        return {"accepted": True}
    return send


def config(**kwargs):
    values = dict(
        api_key="key", secret_key="secret", passphrase="pass",
        live_enabled=False, allowed_project_ids=frozenset({"project-1"}),
    )
    values.update(kwargs)
    return BitgetConfig(**values)


def test_signature_uses_timestamp_method_path_and_body():
    assert make_signature("secret", "123", "GET", "/api/v3/test?x=1") == make_signature(
        "secret", "123", "get", "/api/v3/test?x=1"
    )


def test_read_only_current_copy_is_signed_and_allowlisted():
    calls = []
    adapter = BitgetCopyAdapter(config(), fake_transport(calls))
    result = adapter.current_copy("project-1")
    assert result == {"accepted": True}
    method, path, headers, body = calls[0]
    assert method == "GET"
    assert path == "/api/v3/copy/futures/current-copy?projectId=project-1"
    assert headers["ACCESS-KEY"] == "key"
    assert headers["ACCESS-SIGN"]
    assert body == ""


def test_project_not_allowlisted_is_rejected_before_request():
    calls = []
    adapter = BitgetCopyAdapter(config(), fake_transport(calls))
    try:
        adapter.current_copy("unknown")
    except BitgetError as exc:
        assert "BITGET_COPY_ALLOWED_PROJECT_IDS" in str(exc)
    else:
        raise AssertionError("Expected allowlist rejection")
    assert calls == []


def test_mutation_is_disabled_by_default():
    calls = []
    adapter = BitgetCopyAdapter(config(), fake_transport(calls))
    try:
        adapter.follow("project-1", 50, max_position_value=50)
    except BitgetError as exc:
        assert "disabled" in str(exc)
    else:
        raise AssertionError("Expected live-disabled rejection")
    assert calls == []


def test_bitget_minimum_subscription_is_enforced():
    calls = []
    adapter = BitgetCopyAdapter(config(live_enabled=True), fake_transport(calls))
    try:
        adapter.follow("project-1", 49.99, max_position_value=50)
    except BitgetError as exc:
        assert "50 USDT" in str(exc)
    else:
        raise AssertionError("Expected minimum rejection")
    assert calls == []


def test_follow_enforces_safe_settings_and_uses_verified_endpoint():
    calls = []
    adapter = BitgetCopyAdapter(config(live_enabled=True), fake_transport(calls))
    adapter.follow(
        "project-1", 50, copy_type="fixed_margin", leverage=3,
        auto_copy="off", max_position_value=50, margin_per_order=5,
    )
    method, path, _, body = calls[0]
    assert method == "POST"
    assert path.startswith("/api/v3/copy/futures/follower-settings?")
    assert "autoCopy=off" in path
    assert "leverage=3" in path
    assert "amount=50.00" in path
    assert "marginPerOrder=5.00" in path
    assert "maxMarginRatio=10" in path
    assert body == ""


def test_unfollow_requires_live_and_allowlist():
    calls = []
    adapter = BitgetCopyAdapter(config(live_enabled=True), fake_transport(calls))
    adapter.unfollow("project-1", close_type="follow_close")
    assert calls[0][1].startswith("/api/v3/copy/futures/unfollow?")


def test_follow_rejects_position_notional_above_allocation_and_leverage():
    calls = []
    adapter = BitgetCopyAdapter(config(live_enabled=True), fake_transport(calls))
    try:
        adapter.follow("project-1", 50, leverage=3, max_position_value=151)
    except BitgetError as exc:
        assert "no greater than allocation multiplied by leverage" in str(exc)
    else:
        raise AssertionError("Expected position cap rejection")
    assert calls == []


def test_copy_settings_uses_follower_settings_read_endpoint():
    calls = []
    adapter = BitgetCopyAdapter(config(), fake_transport(calls))
    adapter.copy_settings("project-1")
    assert calls[0][0] == "GET"
    assert calls[0][1] == "/api/v3/copy/futures/copy-settings?projectId=project-1"
