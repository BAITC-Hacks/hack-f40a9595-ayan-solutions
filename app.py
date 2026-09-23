"""Local analyst interface for the reproducible graph pipeline."""

from pathlib import Path
import tempfile
import os

import pandas as pd
import streamlit as st

from analysis import run_pipeline
from ai_brief import local_brief, model_brief, node_context
from graph_view import ROLE_COLORS, render_neighborhood


ROOT = Path(__file__).parent
st.set_page_config(page_title="Граф денег", layout="wide", initial_sidebar_state="expanded")
st.markdown("""<style>
    .block-container { padding-top: 1.35rem; max-width: 1500px; }
    h1 { font-size: 1.9rem !important; }
    div[data-testid="stMetric"] { border-top: 2px solid #e2e9ed; padding-top: .55rem; }
</style>""", unsafe_allow_html=True)
st.title("Граф денег")
st.caption("Внутрибанковские переводы · июль 2026 · аналитические гипотезы для проверки")

with st.sidebar:
    st.subheader("Данные")
    source = st.radio("Источник", ["Предоставленный набор", "Загрузить parquet"], label_visibility="collapsed")
    uploads = {}
    if source == "Загрузить parquet":
        for name in ("nodes", "edges", "transactions"):
            uploads[name] = st.file_uploader(f"{name}.parquet", type="parquet", key=name)
    run = st.button("Рассчитать", type="primary", use_container_width=True)
    st.caption("Полный расчёт выполняется локально. Роль и приоритет — гипотезы, не вывод о виновности.")

if run:
    if source == "Загрузить parquet" and not all(uploads.values()):
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
                        for name, upload in uploads.items():
                            (folder / f"{name}.parquet").write_bytes(upload.getvalue())
                        result = run_pipeline(folder, ROOT / "out")
                st.session_state.result = result
                st.session_state.result_source = source
        except Exception as exc:
            st.error(f"Расчёт не выполнен: {exc}")

if "result" not in st.session_state:
    st.info("Нажмите «Рассчитать», чтобы открыть сеть и список приоритетов.")
    st.stop()

result = st.session_state.result
if st.session_state.result_source != source:
    st.warning("Источник изменён. Нажмите «Рассчитать», чтобы увидеть результаты новых данных.")
    st.stop()

metrics = st.columns(4)
metrics[0].metric("Клиенты", f"{len(result.roles):,}".replace(",", " "))
metrics[1].metric("Переводы", f"{len(result.transactions):,}".replace(",", " "))
metrics[2].metric("Кластеры", len(result.clusters))
metrics[3].metric("Время расчёта", f"{result.manifest['seconds']:.1f} с")

left, right = st.columns([1.15, 1.45], gap="large")
with left:
    st.subheader("Приоритет проверки")
    st.dataframe(result.top[["rank", "gid", "role", "priority_score"]], hide_index=True, use_container_width=True, height=365)
    st.subheader("Найти клиента")
    default_gid = str(int(result.top.iloc[0].gid))
    query = st.text_input("GID", value=default_gid, key="gid_query", help="Введите синтетический идентификатор клиента")
    try:
        gid = int(query.strip())
    except ValueError:
        st.error("Введите целочисленный GID.")
        st.stop()
    if gid not in result.graph:
        st.error("Этот GID отсутствует в загруженном наборе.")
        st.stop()
    role = result.roles.set_index("gid").loc[gid]
    feat = result.features.set_index("gid").loc[gid]
    st.markdown(f"**{gid} · {role.role}**")
    st.write(role.evidence)
    details = st.columns(2)
    details[0].metric("Приоритет", f"{role.priority_score:.3f}")
    details[1].metric("Сила признаков роли", f"{role.role_score:.3f}")
    st.caption(f"Кластер {int(role.cluster_id)} · глубина {int(feat.depth)} · seed: {'да' if feat.is_seed else 'нет'}")
    st.write(f"Вход: {int(feat.in_deg)} плательщиков, {int(feat.in_tx)} переводов, {feat.in_kzt:,.0f} KZT")
    st.write(f"Выход: {int(feat.out_deg)} получателей, {int(feat.out_tx)} переводов, {feat.out_kzt:,.0f} KZT")
    if feat.truncated_by_depth:
        st.warning("Четвёртое колено: дальнейшие исходящие переводы не наблюдаются.")
    elif feat.is_seed:
        st.info("Для seed входящие суммы из-за способа сбора данных могут быть занижены.")
    st.subheader("Справка аналитика")
    context = node_context(result, gid)
    current_key = (tuple(result.manifest["sha256"].values()), gid)
    if st.session_state.get("brief_key") != current_key:
        st.session_state.brief = local_brief(context)
        st.session_state.brief_mode = "Правиловая справка"
        st.session_state.brief_key = current_key
    if os.getenv("OPENAI_API_KEY") and st.button("Подготовить AI-справку"):
        try:
            with st.spinner("Сопоставляем признаки…"):
                st.session_state.brief = model_brief(context)
                st.session_state.brief_mode = "AI-справка"
        except Exception:
            st.session_state.brief = local_brief(context)
            st.session_state.brief_mode = "Правиловая справка (AI недоступен)"
    brief = st.session_state.brief
    st.caption(st.session_state.brief_mode)
    st.write(brief["summary"])
    st.write("Следующий запрос: " + " ".join(brief["next_checks"]))
    if brief["related_gids"]:
        st.caption("Связанные GID: " + ", ".join(brief["related_gids"]))
    st.caption("Ограничение: " + " ".join(brief["limitations"]))
    with st.expander("Контрагенты и суммы"):
        incoming = result.edges[result.edges.dst.eq(gid)][["src", "sum_kzt", "n_tx"]].sort_values("sum_kzt", ascending=False)
        outgoing = result.edges[result.edges.src.eq(gid)][["dst", "sum_kzt", "n_tx"]].sort_values("sum_kzt", ascending=False)
        st.write("Входящие")
        st.dataframe(incoming, hide_index=True, use_container_width=True)
        st.write("Исходящие")
        st.dataframe(outgoing, hide_index=True, use_container_width=True)

with right:
    header, switch = st.columns([2, 1])
    header.subheader("Сеть переводов")
    color_by = switch.segmented_control("Цвет", ["Роль", "Кластер"], default="Роль")
    html, shown, links, hidden = render_neighborhood(result, gid, "role" if color_by == "Роль" else "cluster")
    st.components.v1.html(html, height=585, scrolling=False)
    st.caption(f"Показано {shown} узлов и {links} связей. Скрытых соседей выбранного клиента: {hidden}. Стрелки указывают направление денег.")
    if color_by == "Роль":
        st.caption(" · ".join(f"{name}: {color}" for name, color in ROLE_COLORS.items()))
    st.subheader("Кластеры")
    st.dataframe(result.clusters[["cluster_id", "n_nodes", "n_seed", "sum_kzt_internal", "hypothesis"]], hide_index=True, use_container_width=True, height=210)

st.divider()
st.subheader("Выгрузки")
downloads = st.columns(3)
for column, (filename, data) in zip(downloads, [("nodes_roles.csv", result.roles), ("clusters.csv", result.clusters), ("top_nodes.csv", result.top)]):
    column.download_button(filename, data.to_csv(index=False).encode("utf-8-sig"), file_name=filename, mime="text/csv", use_container_width=True)
