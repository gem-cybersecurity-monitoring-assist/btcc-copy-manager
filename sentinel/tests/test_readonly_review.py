from service import SentinelService
from storage import EventStore


def test_latest_review_with_no_data_has_no_actions(tmp_path, monkeypatch):
    service = SentinelService(EventStore(tmp_path / "review.sqlite"))
    def forbidden(*_args, **_kwargs):
        raise AssertionError("a read-only request must never invoke exchange execution")
    monkeypatch.setattr(service.executor, "execute", forbidden)
    monkeypatch.setattr(service, "_prepare_workflows", forbidden)
    monkeypatch.setattr(service, "_emit_material_alerts", forbidden)
    monkeypatch.setattr(service, "_ai_review_for", forbidden)
    result = service.review_latest()
    assert result["status"] == "no_data"
    assert result["read_only"] is True
    assert result["ranked"] == []
    assert service.store.recent_alerts() == []
