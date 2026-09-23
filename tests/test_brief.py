import json as json_module
from pathlib import Path

import pytest
import requests
from streamlit.testing.v1 import AppTest

from ai_brief import EVIDENCE_REFS, local_brief, model_brief, validate_brief


ROOT = Path(__file__).resolve().parents[1]


def test_local_brief_explains_boundary_and_requests_missing_data():
    context = {
        "evidence": "Граница четвёртого колена; нет наблюдаемых исходящих.",
        "truncated_by_depth": True,
        "is_seed": False,
        "related_gids": ["100000002984403100"],
    }
    brief = local_brief(context)
    assert "четвёртого колена" in brief["next_checks"][0]
    assert brief["related_gids"] == context["related_gids"]


def test_model_brief_rejects_unknown_gid_and_unsupported_number():
    context = {"related_gids": ["101"]}
    brief = {
        "summary": "Наблюдается связанная структура; требуется проверка.",
        "evidence_refs": ["in_degree"],
        "related_gids": ["102"],
        "limitations": ["Видна часть потоков."],
        "next_checks": ["Запросить дополнительные операции."],
    }
    with pytest.raises(ValueError, match="gid"):
        validate_brief(brief, context)
    brief["related_gids"] = ["101"]
    brief["summary"] = "Получил 999 переводов."
    with pytest.raises(ValueError, match="numbers"):
        validate_brief(brief, context)


def test_model_brief_sends_bounded_context_and_validates_response(monkeypatch):
    context = {"gid": "101", "related_gids": ["102"], "in_degree": 3}
    answer = {
        "summary": "Есть признаки консолидации; требуется проверка.",
        "evidence_refs": ["in_degree"],
        "related_gids": ["102"],
        "limitations": ["Граф неполный."],
        "next_checks": ["Запросить полную историю переводов."],
    }

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"status": "completed", "output": [{"type": "message", "content": [
                {"type": "output_text", "text": json_module.dumps(answer)},
            ]}]}

    def fake_post(url, json, headers, timeout):
        assert url == "https://api.openai.com/v1/responses"
        assert json["input"] == json_module.dumps(context, ensure_ascii=False)
        assert json["text"]["format"]["strict"] is True
        assert all(json["text"]["format"]["schema"]["properties"][field]["maxItems"] == 5
                   for field in ("evidence_refs", "related_gids", "limitations", "next_checks"))
        assert json["text"]["format"]["schema"]["properties"]["evidence_refs"]["items"]["enum"] == EVIDENCE_REFS
        assert json["text"]["format"]["schema"]["properties"]["related_gids"]["items"]["enum"] == ["102"]
        assert json["store"] is False
        assert headers["Authorization"] == "Bearer test-key"
        assert timeout == 20
        return Response()

    monkeypatch.setattr(requests, "post", fake_post)
    assert model_brief(context, api_key="test-key", model="test-model") == answer


def test_model_brief_disallows_related_gids_for_isolate(monkeypatch):
    context = {"gid": "101", "related_gids": []}
    answer = {
        "summary": "Недостаточно наблюдаемых связей для вывода.",
        "evidence_refs": ["role"],
        "related_gids": [],
        "limitations": ["Граф неполный."],
        "next_checks": ["Запросить полную историю переводов."],
    }

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"status": "completed", "output": [{"type": "message", "content": [
                {"type": "output_text", "text": json_module.dumps(answer)},
            ]}]}

    def fake_post(url, json, headers, timeout):
        related = json["text"]["format"]["schema"]["properties"]["related_gids"]
        assert related["maxItems"] == 0
        assert "enum" not in related["items"]
        return Response()

    monkeypatch.setattr(requests, "post", fake_post)
    assert model_brief(context, api_key="test-key", model="test-model") == answer


def test_ai_button_success_and_timeout_fallback(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    answer = {
        "summary": "Наблюдаются признаки координации; необходима проверка.",
        "evidence_refs": ["seed_reach", "out_degree"],
        "related_gids": [],
        "limitations": ["Наблюдается только часть переводов."],
        "next_checks": ["Запросить недостающие входящие переводы."],
    }

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"status": "completed", "output": [{"type": "message", "content": [
                {"type": "output_text", "text": json_module.dumps(answer)},
            ]}]}

    monkeypatch.setattr(requests, "post", lambda *args, **kwargs: Response())
    app = AppTest.from_file(ROOT / "app.py", default_timeout=15).run()
    next(button for button in app.button if button.label == "Рассчитать").click().run()
    next(button for button in app.button if button.label == "Подготовить AI-справку").click().run()
    assert not app.exception
    assert any(caption.value == "AI-справка" for caption in app.get("caption"))
    assert any("Основания: достижимость от seed · получатели" in caption.value for caption in app.get("caption"))
    assert any(answer["summary"] in item.value for item in app.markdown)

    def timeout(*args, **kwargs):
        raise requests.Timeout("test timeout")

    monkeypatch.setattr(requests, "post", timeout)
    next(button for button in app.button if button.label == "Подготовить AI-справку").click().run()
    assert not app.exception
    assert any(caption.value == "Правиловая справка (AI недоступен)" for caption in app.get("caption"))
