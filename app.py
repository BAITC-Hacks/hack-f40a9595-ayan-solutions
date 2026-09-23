"""Local analyst interface for the reproducible graph pipeline."""

from pathlib import Path
import hashlib
import tempfile
import os

import streamlit as st
from dotenv import load_dotenv

from analysis import run_pipeline
from workspace import render_workspace


ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env", override=False)
INPUT_NAMES = ("nodes", "edges", "transactions")
st.set_page_config(page_title="Граф денег", layout="wide", initial_sidebar_state="expanded")
st.markdown("<style>" + (ROOT / "assets" / "workspace.css").read_text() + "</style>", unsafe_allow_html=True)
st.title("Граф денег")
period_caption = st.empty()
period_caption.caption("Анализ транзакционной сети")

with st.sidebar:
    st.subheader("Рабочий набор")
    source = st.radio("Источник", ["Предоставленный набор", "Загрузить parquet"], label_visibility="collapsed")
    uploads = {}
    if source == "Загрузить parquet":
        for name in INPUT_NAMES:
            uploads[name] = st.file_uploader(f"{name}.parquet", type="parquet", key=name)
    run = st.button("Рассчитать", type="primary", width="stretch", icon=":material/refresh:")
    dataset_status = st.empty()
    st.divider()
    st.caption("Обработка данных")
    st.write("Локальный расчёт")
    st.caption("AI-провайдер")
    st.write("OpenAI · ключ настроен" if os.getenv("OPENAI_API_KEY") else "Не настроен")
    st.caption("AI-интерпретации требуют проверки аналитиком.")

if source == "Предоставленный набор":
    input_paths = {name: ROOT / "data" / f"{name}.parquet" for name in INPUT_NAMES}
    current_hashes = (
        {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in input_paths.items()}
        if all(path.is_file() for path in input_paths.values()) else None
    )
else:
    input_bytes = {name: upload.getvalue() for name, upload in uploads.items() if upload is not None}
    current_hashes = (
        {name: hashlib.sha256(data).hexdigest() for name, data in input_bytes.items()}
        if len(input_bytes) == len(INPUT_NAMES) else None
    )

if run:
    if source == "Загрузить parquet" and current_hashes is None:
        st.error("Загрузите все три parquet-файла.")
        st.session_state.pop("result", None)
    else:
        st.session_state.pop("result", None)
        try:
            with st.spinner("Проверяем данные и рассчитываем граф…"):
                if source == "Предоставленный набор":
                    result = run_pipeline(ROOT / "data", ROOT / "out")
                else:
                    with tempfile.TemporaryDirectory() as temporary:
                        folder = Path(temporary)
                        for name, data in input_bytes.items():
                            (folder / f"{name}.parquet").write_bytes(data)
                        result = run_pipeline(folder, folder / "out")
                st.session_state.result = result
                st.session_state.result_source = source
                st.session_state.gid_query = str(int(result.top.iloc[0].gid))
                st.session_state.workspace = "Обзор"
        except Exception as exc:
            st.error(f"Расчёт не выполнен: {exc}")

if "result" not in st.session_state:
    dataset_status.caption("Ожидает расчёта" if current_hashes else "Набор не укомплектован")
    st.subheader("Подготовка данных")
    st.info("Результат расчёта пока отсутствует.")
    st.dataframe([
        {"Файл": f"{name}.parquet", "Содержимое": label,
         "Состояние": "Доступен" if (input_paths[name].is_file() if source == "Предоставленный набор" else name in input_bytes) else "Отсутствует"}
        for name, label in zip(INPUT_NAMES, ("Клиенты и глубина наблюдения", "Агрегированные направленные связи", "Даты и суммы переводов"))
    ], hide_index=True, width="stretch")
    st.stop()

result = st.session_state.result
if st.session_state.result_source != source or current_hashes != result.manifest["sha256"]:
    dataset_status.caption("Требуется пересчёт")
    st.warning("Входные файлы изменились. Нажмите «Рассчитать», чтобы увидеть результаты новых данных.")
    st.stop()

dataset_status.caption(f"Готово · {result.manifest['seconds']:.2f} с")
first_date = result.transactions.date.min().date()
last_date = result.transactions.date.max().date()
period = str(first_date) if first_date == last_date else f"{first_date} — {last_date}"
period_caption.caption(f"Внутрибанковские переводы · {period} · {source}")
analysis_key = (source, tuple(sorted(result.manifest["sha256"].items())), tuple(sorted(result.manifest["config"].items())))
render_workspace(result, analysis_key)
