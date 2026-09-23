from html.parser import HTMLParser
from pathlib import Path

import pandas as pd
from streamlit.testing.v1 import AppTest

from analysis import run_pipeline
from graph_view import render_neighborhood
import ui


ROOT = Path(__file__).resolve().parents[1]


def test_filters_preserve_identifiers_and_combine_without_changing_results(tmp_path):
    result = run_pipeline(ROOT / "data", tmp_path / "out")
    before = result.roles.copy(deep=True)
    rows = ui.client_rows(result)
    assert rows.gid.tolist()[:50] == result.top.gid.tolist()
    selected = rows.iloc[60]
    filtered = ui.filter_clients(rows, scope="Все клиенты", role=selected.role,
                                 cluster=int(selected.cluster_id), query=str(selected.gid)[-9:])
    assert int(selected.gid) in filtered.gid.tolist()
    assert filtered.role.eq(selected.role).all()
    assert filtered.cluster_id.eq(selected.cluster_id).all()
    assert ui.filter_clients(rows, query="[").empty
    pd.testing.assert_frame_equal(result.roles, before)


def test_table_callback_opens_exact_filtered_client(monkeypatch):
    frame = pd.DataFrame({"gid": [100000003684369100, 100000003115284100],
                          "role": ["coordinator", "consolidator"], "priority_score": [.9, .8],
                          "in_kzt": [1., 2.], "out_kzt": [3., 4.], "cluster_id": [2, 1]})
    state, captured = {}, {}

    def dataframe(data, **kwargs):
        captured.update(kwargs)
        assert data.gid.tolist() == [str(gid) for gid in frame.gid]

    monkeypatch.setattr(ui.st, "session_state", state)
    monkeypatch.setattr(ui.st, "dataframe", dataframe)
    ui.client_table(frame, "filtered_queue")
    state[captured["key"]] = {"selection": {"rows": [1]}}
    captured["on_select"]()
    assert state["gid_query"] == "100000003115284100"
    assert state["workspace"] == "Клиент"
    assert state[captured["key"]]["selection"]["rows"] == []


def test_workspace_filters_navigation_empty_state_and_recovery(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    app = AppTest.from_file(ROOT / "app.py", default_timeout=15).run()
    app.button[0].click().run()
    assert not app.exception
    assert {"Обзор", "Клиент", "Кластеры", "Данные"}.issubset({item.label for item in app.tabs})
    queue = next(item for item in app.dataframe if item.key and item.key.startswith("queue_"))
    assert len(queue.value) == 50
    app.selectbox(key="queue_role").set_value("coordinator").run()
    queue = next(item for item in app.dataframe if item.key and item.key.startswith("queue_"))
    assert queue.value.role.eq("Координатор").all()
    app.text_input(key="queue_query").set_value("not-a-gid").run()
    assert any("Клиентов с такими параметрами нет" in item.value for item in app.info)
    app.button(key="reset_filters").click().run()
    assert app.text_input(key="queue_query").value == ""
    first_gid = app.text_input(key="gid_query").value
    app.button(key="next_client").click().run()
    assert app.session_state.workspace == "Клиент"
    assert app.text_input(key="gid_query").value != first_gid
    app.button(key="previous_client").click().run()
    assert app.text_input(key="gid_query").value == first_gid
    app.text_input(key="gid_query").set_value("invalid").run()
    assert any("целочисленный GID" in item.value for item in app.error)
    assert any(item.label == "Данные" for item in app.tabs)
    app.text_input(key="gid_query").set_value(first_gid).run()
    assert not app.error
    assert not app.exception


def test_graph_is_self_contained_and_preserves_directed_node_ids(tmp_path):
    result = run_pipeline(ROOT / "data", tmp_path / "out")
    gid = int(result.top.iloc[0].gid)
    html, shown, links, hidden = render_neighborhood(result, gid)
    assert shown > 1 and links > 0 and hidden == 0
    assert f'"id": "{gid}"' in html
    assert '"arrows"' in html
    assert 'aria-label="Направленный граф' in html

    class ExternalAssets(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag in {"script", "link"}:
                assert not any(name in {"src", "href"} for name, _ in attrs)

    ExternalAssets().feed(html)
