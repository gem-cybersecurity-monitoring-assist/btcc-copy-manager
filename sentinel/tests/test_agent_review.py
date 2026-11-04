import json

import agent_review
from agent_review import apply_ai_veto, run_ai_review
from models import Provenance, TradeRecord, TraderSnapshot


def sample_trader():
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    return TraderSnapshot(
        name="Public Trader", trader_id="trader-1", exchange="bitget",
        exchange_project_id="project-1", pnl_30d_pct=12.5, win_rate_pct=68,
        recent_trades=[
            TradeRecord(symbol="BTCUSDT", direction="LONG", leverage=3, margin_usdt=5,
                        pnl_usdt=1, pnl_ratio_pct=4, closed_at=now)
        ],
        source_timestamp=now,
        provenance=Provenance(source="manual", confidence=0.99),
    )


def test_ai_review_disabled_without_external_call(monkeypatch):
    monkeypatch.setenv("GEM_AI_REVIEW_ENABLED", "false")
    result = run_ai_review([sample_trader()])
    assert result["status"] == "disabled"
    assert result["veto_ids"] == []


def test_ai_review_fails_closed_when_enabled_without_credentials(monkeypatch):
    monkeypatch.setenv("GEM_AI_REVIEW_ENABLED", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_MODEL", "model-name")
    result = run_ai_review([sample_trader()])
    plan = {"selected": [{"trader": "Public Trader", "trader_id": "trader-1"}], "excluded": []}
    updated = apply_ai_veto(plan, result)
    assert result["status"] == "error"
    assert updated["selected"] == []
    assert "fail closed" in updated["excluded"][0]["reasons"][0]


def test_ai_review_uses_structured_output_and_can_only_veto(monkeypatch):
    monkeypatch.setenv("GEM_AI_REVIEW_ENABLED", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    captured = {}

    class Response:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self):
            return json.dumps({
                "output": [{
                    "type": "message",
                    "content": [{
                        "type": "output_text",
                        "text": json.dumps({
                            "summary": "Risk evidence is incomplete.",
                            "reviews": [{
                                "trader_id": "trader-1",
                                "action": "REVIEW",
                                "confidence": 0.9,
                                "reasons": ["Missing drawdown history."],
                                "missing_evidence": ["Maximum drawdown"],
                            }],
                        }),
                    }],
                }],
            }).encode()

    def fake_urlopen(request, timeout):
        captured["payload"] = json.loads(request.data.decode())
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(agent_review, "urlopen", fake_urlopen)
    result = run_ai_review([sample_trader()])
    plan = {"selected": [{"trader": "Public Trader", "trader_id": "trader-1"}], "excluded": []}
    updated = apply_ai_veto(plan, result)
    assert result["status"] == "ok"
    assert captured["payload"]["text"]["format"]["type"] == "json_schema"
    assert "account" not in captured["payload"]["input"]
    assert updated["selected"] == []
    assert updated["excluded"][0]["ai_action"] == "REVIEW"
