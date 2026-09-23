import hashlib
from pathlib import Path

from streamlit.testing.v1 import AppTest


ROOT = Path(__file__).resolve().parents[1]
INPUT_NAMES = ("nodes", "edges", "transactions")
EXPORT_NAMES = ("nodes_roles.csv", "clusters.csv", "top_nodes.csv")


def test_upload_validation_and_export_isolation():
    exports_before = {
        name: hashlib.sha256((ROOT / "out" / name).read_bytes()).hexdigest()
        for name in EXPORT_NAMES
    }
    app = AppTest.from_file(ROOT / "app.py", default_timeout=15).run()
    assert not app.exception

    app.radio[0].set_value("Загрузить parquet").run()
    app.button[0].click().run()
    assert any("Загрузите все три" in item.value for item in app.error)
    assert not app.metric

    for index, name in enumerate(INPUT_NAMES):
        content = (ROOT / "data" / f"{name}.parquet").read_bytes()
        app.get("file_uploader")[index].upload(f"{name}.parquet", content)
    app.run()
    app.button[0].click().run()
    assert not app.exception
    assert not app.error
    assert next(item.value for item in app.metric if item.label == "Клиенты") == "2 248"
    assert {
        name: hashlib.sha256((ROOT / "out" / name).read_bytes()).hexdigest()
        for name in EXPORT_NAMES
    } == exports_before

    app.get("file_uploader")[0].upload("nodes.parquet", b"not a parquet file")
    app.run()
    assert any("Входные файлы изменились" in item.value for item in app.warning)
    assert not app.metric

    app.button[0].click().run()
    assert any("Cannot read nodes.parquet" in item.value for item in app.error)
    assert not app.metric
    assert {
        name: hashlib.sha256((ROOT / "out" / name).read_bytes()).hexdigest()
        for name in EXPORT_NAMES
    } == exports_before
