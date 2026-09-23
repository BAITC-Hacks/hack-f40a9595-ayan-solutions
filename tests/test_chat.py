from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path

import pandas as pd
import pytest
import requests
from streamlit.testing.v1 import AppTest

from ai_chat import MAX_CHAT_TURNS, chat_context, model_answer, validate_answer
from analysis import run_pipeline


ROOT = Path(__file__).resolve().parents[1]
ANSWER = {
    "answer": "Роль основана на наблюдаемых связях; для проверки нужна полная история переводов.",
    "evidence_refs": ["role", "in_degree"],
    "related_gids": [],
    "limitations": ["Наблюдается только часть сети."],
}


class Response:
    def raise_for_status(self):
        pass

    def json(self):
        return {"status": "completed", "output": [{"type": "message", "content": [
            {"type": "output_text", "text": json.dumps(ANSWER)},
        ]}]}


def test_chat_context_matches_graph_and_handles_isolate(tmp_path):
    result = run_pipeline(ROOT / "data", tmp_path / "out")
    gid = int(result.top.iloc[0].gid)
    context = chat_context(result, gid)
    facts = context["facts"]
    assert facts["in_tx"] == int(result.edges.loc[result.edges.dst.eq(gid), "n_tx"].sum())
    assert facts["out_kzt"] == result.edges.loc[result.edges.src.eq(gid), "sum_kzt"].sum()
    assert len(context["neighbors"]) <= 10
    for neighbor in context["neighbors"]:
        other = int(neighbor["gid"])
        assert neighbor["to_selected_kzt"] == result.graph.get_edge_data(other, gid, {}).get("sum_kzt", 0)
    isolate = next(node for node, degree in result.graph.degree if degree == 0)
    empty = chat_context(result, isolate)
    assert empty["neighbors"] == []
    assert empty["facts"]["pass_through"] is None
    json.dumps(empty, allow_nan=False)


def test_chat_sends_bounded_history_and_current_question(monkeypatch):
    context = {"gid": "101", "facts": {"role": "transit", "in_degree": 2}, "related_gids": ["102"]}
    history = [{"question": f"question-{index}", "answer": ANSWER} for index in range(10)]
    captured = []

    def post(url, json, headers, timeout):
        captured.append(json)
        assert headers["Authorization"] == "Bearer test-key"
        assert timeout == 20
        return Response()

    monkeypatch.setattr(requests, "post", post)
    assert model_answer(context, "  Что проверить дальше?  ", history, api_key="test-key") == ANSWER
    payload = captured[0]
    assert json.loads(payload["input"][0]["content"])["graph_context"] == context
    assert payload["input"][1]["content"] == history[-MAX_CHAT_TURNS]["question"]
    assert payload["input"][-1] == {"role": "user", "content": "Что проверить дальше?"}
    assert len(payload["input"]) == 2 + 2 * MAX_CHAT_TURNS
    assert payload["store"] is False
    for question in (" ", "x" * 1001):
        with pytest.raises(ValueError, match="Question"):
            model_answer(context, question, api_key="test-key")
    assert len(captured) == 1


@pytest.mark.parametrize("field,value,match", [
    ("evidence_refs", ["invented_metric"], "unsupported evidence"),
    ("related_gids", ["999"], "unknown gid"),
    ("answer", "Клиент получил 999 переводов.", "unverified numbers"),
])
def test_chat_rejects_unverified_output(field, value, match):
    context = {"facts": {"role": "transit", "in_degree": 2}, "related_gids": ["102"]}
    answer = deepcopy(ANSWER)
    answer[field] = value
    with pytest.raises(ValueError, match=match):
        validate_answer(answer, context)


def test_chat_ui_history_node_isolation_retry_and_clear(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    calls = []
    fail = False

    def post(url, json, headers, timeout):
        calls.append(json)
        if fail:
            raise requests.Timeout("simulated timeout")
        return Response()

    monkeypatch.setattr(requests, "post", post)
    app = AppTest.from_file(ROOT / "app.py", default_timeout=15).run()
    app.button[0].click().run()
    first_gid = int(app.text_input[0].value)
    app.chat_input[0].set_value("Почему такая роль?").run()
    app.chat_input[0].set_value("А чего не хватает для проверки?").run()
    assert not app.exception
    assert len(app.chat_message) == 4
    assert calls[-1]["input"][1]["content"] == "Почему такая роль?"
    assert any("Плательщики:" in item.value for item in app.get("caption"))
    assert any("AI-интерпретация: роль является гипотезой" in item.value for item in app.get("caption"))

    second_gid = int(app.session_state.result.top.iloc[1].gid)
    app.text_input[0].set_value(str(second_gid)).run()
    assert not app.chat_message
    app.chat_input[0].set_value("Почему этот клиент в списке?").run()
    assert len(calls[-1]["input"]) == 2
    assert json.loads(calls[-1]["input"][0]["content"])["graph_context"]["gid"] == str(second_gid)
    app.text_input[0].set_value(str(first_gid)).run()
    assert len(app.chat_message) == 4
    app.button(key="clear_chat").click().run()
    assert not app.chat_message
    assert len(app.session_state.node_chats[second_gid]["turns"]) == 1

    fail = True
    app.chat_input[0].set_value("Как уточнить гипотезу?").run()
    assert not app.exception
    assert any("Вопрос сохранён" in item.value for item in app.error)
    assert app.session_state.node_chats[first_gid]["pending"] == "Как уточнить гипотезу?"
    count = len(calls)
    app.run()
    assert len(calls) == count
    fail = False
    app.button(key="retry_chat").click().run()
    assert len(app.chat_message) == 2
    assert not app.error
    assert app.session_state.node_chats[first_gid]["pending"] is None

    app.radio[0].set_value("Загрузить parquet").run()
    for index, name in enumerate(("nodes", "edges", "transactions")):
        frame = pd.read_parquet(ROOT / "data" / f"{name}.parquet")
        if name == "transactions":
            frame["date"] = (pd.to_datetime(frame.date) + pd.DateOffset(months=1)).dt.strftime("%Y-%m-%d")
        content = BytesIO()
        frame.to_parquet(content, index=False)
        app.get("file_uploader")[index].upload(f"{name}.parquet", content.getvalue())
    app.run()
    app.button[0].click().run()
    assert not app.exception
    assert not app.chat_message
    assert all(not chat["turns"] for chat in app.session_state.node_chats.values())


def test_chat_ui_disabled_without_api_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    app = AppTest.from_file(ROOT / "app.py", default_timeout=15).run()
    app.button[0].click().run()
    assert not app.exception
    assert app.chat_input[0].disabled
