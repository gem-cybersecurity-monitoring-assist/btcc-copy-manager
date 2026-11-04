from storage import EventStore


def test_exchange_action_ledger_is_idempotent_and_rejects_payload_reuse(tmp_path):
    store = EventStore(tmp_path / "ledger.db")
    created, row = store.begin_exchange_action(
        "follow-project-1-001", "bitget", "FOLLOW", "project-1", {"amount": 50}
    )
    assert created is True
    assert row["status"] == "PENDING"

    created_again, existing = store.begin_exchange_action(
        "follow-project-1-001", "bitget", "FOLLOW", "project-1", {"amount": 50}
    )
    assert created_again is False
    assert existing["status"] == "PENDING"

    try:
        store.begin_exchange_action(
            "follow-project-1-001", "bitget", "FOLLOW", "project-1", {"amount": 100}
        )
    except ValueError as exc:
        assert "different request payload" in str(exc)
    else:
        raise AssertionError("Expected idempotency payload mismatch")


def test_exchange_action_ledger_records_success_and_unknown_without_retry(tmp_path):
    store = EventStore(tmp_path / "ledger.db")
    store.begin_exchange_action("close-1", "bitget", "CLOSE_ALL", "project-1", {})
    assert store.finish_exchange_action("close-1", "EXECUTED", {"code": "00000"})
    row = store.get_exchange_action("close-1")
    assert row["status"] == "EXECUTED"
    assert row["response"] == {"code": "00000"}
    assert store.finish_exchange_action("close-1", "UNKNOWN", error="timeout") is False

    store.begin_exchange_action("unfollow-1", "bitget", "UNFOLLOW", "project-1", {})
    assert store.finish_exchange_action("unfollow-1", "UNKNOWN", error="connection lost")
    created, row = store.begin_exchange_action("unfollow-1", "bitget", "UNFOLLOW", "project-1", {})
    assert created is False
    assert row["status"] == "UNKNOWN"


def test_active_subscription_registry_persists_and_marks_inactive(tmp_path):
    store = EventStore(tmp_path / "ledger.db")
    store.mark_subscription_active("project-1", "bitget", "trader-1", "Leader", 50, 3, 150)
    active = store.get_active_subscription("project-1")
    assert active["status"] == "ACTIVE"
    assert active["amount_usdt"] == 50
    assert store.list_active_subscriptions()[0]["project_id"] == "project-1"
    store.mark_subscription_inactive("project-1")
    assert store.get_active_subscription("project-1") is None
