"""Task-oriented views over the existing analysis result."""

import hashlib
import json
import os

import altair as alt
import pandas as pd
import streamlit as st

from ai_brief import local_brief, model_brief, node_context
from ai_chat import FACT_LABELS, MAX_CHAT_TURNS, MAX_QUESTION_CHARS, chat_context, model_answer
from ai_safety import AI_POLICY_VERSION, UnsafeAIInput, UnsafeAIOutput
from graph_view import render_neighborhood
from temporal import daily_activity, temporal_summary
from ui import ROLE_LABELS, activate_client, client_rows, client_table, filter_clients, number, role_badge, show_legend


def reset_filters():
    st.session_state.queue_scope = "Топ-50"
    st.session_state.queue_role = "Все роли"
    st.session_state.queue_cluster = "Все кластеры"
    st.session_state.queue_query = ""


def render_overview(result, rows, dataset_id):
    with st.container(key="overview_metrics"):
        metrics = st.columns(4)
    metrics[0].metric("Клиенты", number(len(result.roles)))
    metrics[1].metric("Переводы", number(len(result.transactions)))
    metrics[2].metric("Объём, KZT", number(result.transactions.sum_kzt.sum()))
    metrics[3].metric("Кластеры", number(len(result.clusters)))
    st.subheader("Очередь проверки")
    st.segmented_control("Выборка", ["Топ-50", "Все клиенты"], default="Топ-50", required=True,
                         key="queue_scope", label_visibility="collapsed")
    with st.container(key="queue_filters"):
        filters = st.columns([2, 2, 2, .45], vertical_alignment="bottom")
    role = filters[0].selectbox("Роль", ["Все роли", *ROLE_LABELS], key="queue_role",
                                 format_func=lambda value: ROLE_LABELS.get(value, value))
    cluster = filters[1].selectbox("Кластер", ["Все кластеры", *sorted(result.clusters.cluster_id)], key="queue_cluster")
    query = filters[2].text_input("Поиск по GID", key="queue_query", placeholder="Идентификатор или часть")
    filters[3].button("", icon=":material/filter_alt_off:", help="Сбросить фильтры", key="reset_filters", on_click=reset_filters)
    filtered = filter_clients(rows, scope=st.session_state.queue_scope, role=role, cluster=cluster, query=query)
    st.caption(f"В выборке: {number(len(filtered))} · всего клиентов: {number(len(rows))}")
    if filtered.empty:
        st.info("Клиентов с такими параметрами нет.")
    else:
        client_table(filtered, f"queue_{dataset_id}")
    st.caption("Приоритет и роль являются аналитическими гипотезами, не оценкой вероятности нарушения.")


def render_chat(result, gid, analysis_key, brief):
    chat = st.session_state.node_chats.setdefault(gid, {"turns": [], "pending": None})
    chat_id = hashlib.sha256(repr((analysis_key, gid)).encode()).hexdigest()[:16]
    header, action = st.columns([8, 1], vertical_alignment="center")
    header.subheader("Вопросы по клиенту")
    if action.button("", icon=":material/delete:", help="Очистить диалог", key="clear_chat"):
        chat = {"turns": [], "pending": None}
        st.session_state.node_chats[gid] = chat
    question_context = chat_context(result, gid)
    api_available = bool(os.getenv("OPENAI_API_KEY"))
    retry = False
    with st.container(**({"height": 380, "border": False} if chat["turns"] or chat["pending"] else {})):
        for turn in chat["turns"]:
            with st.chat_message("user"):
                st.text(turn["question"])
            with st.chat_message("assistant"):
                answer = turn["answer"]
                st.text(answer["answer"])
                st.caption("AI-интерпретация: роль является гипотезой, а не установленным фактом.")
                for ref in answer["evidence_refs"]:
                    value = question_context["facts"][ref]
                    if value is None:
                        value = "не определяется"
                    elif isinstance(value, bool):
                        value = "да" if value else "нет"
                    elif isinstance(value, float):
                        value = number(value, 2) if ref in ("in_kzt", "out_kzt") else f"{value:.6g}"
                    st.caption(f"{FACT_LABELS[ref]}: {value}")
                for neighbor in question_context["neighbors"]:
                    if neighbor["gid"] in answer["related_gids"]:
                        st.caption(f"GID {neighbor['gid']} · {ROLE_LABELS[neighbor['role']]} · "
                                   f"перевёл выбранному: {number(neighbor['to_selected_kzt'], 2)} KZT · "
                                   f"получил от выбранного: {number(neighbor['from_selected_kzt'], 2)} KZT")
                if answer["limitations"]:
                    st.text("Ограничения: " + " ".join(answer["limitations"]))
        if chat["pending"]:
            with st.chat_message("user"):
                st.text(chat["pending"])
            st.error("Не удалось получить проверенный ответ. Вопрос сохранён.")
            retry = st.button("Повторить", icon=":material/refresh:", key="retry_chat", disabled=not api_available)
    if chat.get("safety_notice"):
        st.warning(chat["safety_notice"])
    if not api_available:
        st.caption("AI недоступен: ключ не настроен.")
    submitted = st.chat_input("Уточняющий вопрос по клиенту", max_chars=MAX_QUESTION_CHARS,
                              key=f"question_{chat_id}", disabled=not api_available)
    question = submitted.strip() if submitted else chat["pending"] if retry else None
    if question:
        chat.pop("safety_notice", None)
        try:
            with st.spinner("Готовим ответ по данным клиента…"):
                answer = model_answer(question_context, question, history=chat["turns"], brief=brief)
        except UnsafeAIInput:
            chat["pending"] = None
            chat["safety_notice"] = "Запрос не отправлен: обнаружены небезопасные инструкции или содержимое. Задайте вопрос по данным клиента."
        except UnsafeAIOutput:
            chat["pending"] = None
            chat["safety_notice"] = "Ответ AI не прошёл проверку безопасности и не сохранён. Переформулируйте вопрос по данным клиента."
        except Exception:
            chat["pending"] = question
        else:
            chat["turns"].append({"question": question, "answer": answer})
            chat["turns"] = chat["turns"][-MAX_CHAT_TURNS:]
            chat["pending"] = None
        st.rerun()


def render_ai(result, gid, analysis_key):
    context = node_context(result, gid)
    current_key = (AI_POLICY_VERSION, analysis_key, gid, context["active_days"], context["same_day_both"])
    if st.session_state.get("brief_key") != current_key:
        st.session_state.brief = local_brief(context)
        st.session_state.brief_mode = "Правиловая справка"
        st.session_state.brief_key = current_key
    with st.expander("Справка аналитика", expanded=True):
        if os.getenv("OPENAI_API_KEY") and st.button("Подготовить AI-справку", icon=":material/auto_awesome:"):
            try:
                with st.spinner("Сопоставляем признаки…"):
                    st.session_state.brief = model_brief(context)
                    st.session_state.brief_mode = "AI-справка"
            except Exception:
                st.session_state.brief = local_brief(context)
                st.session_state.brief_mode = "Правиловая справка (AI недоступен)"
        brief = st.session_state.brief
        st.caption(st.session_state.brief_mode)
        st.text(brief["summary"])
        evidence_labels = {
            "in_degree": "плательщики", "out_degree": "получатели",
            "in_kzt": "входящая сумма", "out_kzt": "исходящая сумма",
            "seed_reach": "достижимость от seed", "cluster_id": "кластер",
            "depth": "колено", "role": "роль", "priority_score": "приоритет",
            "active_days": "активные дни", "same_day_both": "совпадение входа и выхода по дню",
        }
        st.caption("Основания: " + " · ".join(evidence_labels[key] for key in brief["evidence_refs"]))
        st.text("Следующий запрос: " + " ".join(brief["next_checks"]))
        if brief["related_gids"]:
            st.caption("Связанные GID: " + ", ".join(brief["related_gids"]))
        st.text("Ограничение: " + " ".join(brief["limitations"]))
    render_chat(result, gid, analysis_key, brief)


def render_client(result, rows, analysis_key, dataset_id):
    with st.container(key="client_toolbar"):
        search, previous, following = st.columns([8, 1, 1], vertical_alignment="bottom")
    query = search.text_input("GID", key="gid_query", help="Полный идентификатор клиента из текущего набора")
    try:
        gid = int(query.strip())
    except ValueError:
        st.error("Введите целочисленный GID.")
        return
    if gid not in result.graph:
        st.error("Этот GID отсутствует в загруженном наборе.")
        return
    sequence = rows.gid.tolist()
    index = sequence.index(gid)
    previous.button("", icon=":material/arrow_back:", help="Предыдущий клиент по приоритету", key="previous_client",
                    disabled=index == 0, on_click=activate_client, args=(sequence[max(0, index - 1)],))
    following.button("", icon=":material/arrow_forward:", help="Следующий клиент по приоритету", key="next_client",
                     disabled=index == len(sequence) - 1, on_click=activate_client, args=(sequence[min(len(sequence) - 1, index + 1)],))
    role = result.roles.set_index("gid").loc[gid]
    feat = result.features.set_index("gid").loc[gid]
    daily = daily_activity(result.transactions, gid)
    timing = temporal_summary(daily)
    summary, detail = st.columns([1, 2.3], gap="large")
    with summary, st.container(key="client_summary"):
        st.markdown('<div class="client-role">' + role_badge(role.role) + '</div>', unsafe_allow_html=True)
        st.caption(f"{role.role} · кластер {int(role.cluster_id)} · колено {int(feat.depth)}")
        with st.expander("Основания роли"):
            st.write(role.evidence)
        scores = st.columns(2)
        scores[0].metric("Приоритет", f"{role.priority_score:.3f}", help="Очередность проверки, не вероятность нарушения")
        scores[1].metric("Признаки", f"{role.role_score:.3f}", help="Сила выполнения правила роли, не точность классификации")
        st.metric("Вход, KZT", number(feat.in_kzt, 2))
        st.caption(f"{int(feat.in_deg)} плательщиков · {int(feat.in_tx)} переводов")
        st.metric("Выход, KZT", number(feat.out_kzt, 2))
        st.caption(f"{int(feat.out_deg)} получателей · {int(feat.out_tx)} переводов")
        if feat.truncated_by_depth:
            st.warning("Четвёртое колено: дальнейшие исходящие переводы не наблюдаются.")
        elif feat.is_seed:
            st.info("Seed: входящие суммы в выборке могут быть занижены.")
    with detail:
        network, counterparties, activity, ai = st.tabs(["Связи", "Контрагенты", "Активность", "AI-аналитик"],
                                                       key="client_view", on_change="rerun")
        with network:
            color_by = st.segmented_control("Цвет узлов", ["Роль", "Кластер"], default="Роль", required=True,
                                             key="graph_color", label_visibility="collapsed")
            html, shown, links, hidden = render_neighborhood(result, gid, "role" if color_by == "Роль" else "cluster")
            st.iframe(html, height=440)
            if color_by == "Роль":
                show_legend()
            st.caption(f"Узлы: {shown} · связи: {links} · соседей за пределами отображения: {hidden}")
            st.caption("Направление стрелки совпадает с направлением перевода.")
        with counterparties:
            direction = st.segmented_control("Поток", ["Входящие", "Исходящие"], default="Входящие", required=True, key="flow_direction")
            incoming = direction == "Входящие"
            selected = result.edges.loc[result.edges.dst.eq(gid) if incoming else result.edges.src.eq(gid)]
            column = "src" if incoming else "dst"
            peers = selected[[column, "sum_kzt", "n_tx"]].rename(columns={column: "gid"}).sort_values("sum_kzt", ascending=False)
            st.caption(f"Контрагенты: {len(peers)} · объём: {number(peers.sum_kzt.sum(), 2)} KZT")
            if peers.empty:
                st.info("Переводы в этом направлении не наблюдаются.")
            else:
                peer_rows = peers.merge(rows, on="gid", validate="one_to_one")
                client_table(peer_rows, f"peers_{dataset_id}_{gid}_{incoming}", height=300)
        with activity:
            counts = st.columns(2)
            counts[0].metric("Активные дни", timing["active_days"])
            counts[1].metric("Дни с входом и выходом", timing["same_day_both"])
            if daily.empty:
                st.info("Переводов в наблюдаемом наборе нет.")
            else:
                activity_data = daily[["in_kzt", "out_kzt"]].rename(columns={"in_kzt": "Вход", "out_kzt": "Выход"}).reset_index()
                activity_data = activity_data.melt(id_vars="date", var_name="Поток", value_name="Сумма")
                chart = alt.Chart(activity_data).mark_bar().encode(
                    x=alt.X("date:O", timeUnit="yearmonthdate", axis=alt.Axis(format="%d.%m", title=None, labelAngle=-45, labelOverlap=True)),
                    xOffset="Поток:N", y=alt.Y("Сумма:Q", title="KZT", stack=None),
                    color=alt.Color("Поток:N", scale=alt.Scale(domain=["Вход", "Выход"], range=["#187569", "#bf6b3c"]),
                                    legend=alt.Legend(title=None, orient="bottom")),
                    tooltip=[alt.Tooltip("date:T", title="Дата", format="%d.%m.%Y"), "Поток:N", alt.Tooltip("Сумма:Q", format=",.2f")],
                ).properties(height=280)
                st.altair_chart(chart, width="stretch")
                st.caption(f"Максимум за день: вход {number(timing['max_daily_in_kzt'], 2)} KZT · выход {number(timing['max_daily_out_kzt'], 2)} KZT")
            st.caption("Совпадение по дню не устанавливает порядок операций и не доказывает транзит.")
        with ai:
            render_ai(result, gid, analysis_key)


def render_clusters(result, rows, dataset_id):
    st.subheader("Кластеры сети")
    st.dataframe(result.clusters[["cluster_id", "n_nodes", "n_seed", "sum_kzt_internal"]], hide_index=True,
                 width="stretch", height=260, column_config={
                     "cluster_id": "Кластер", "n_nodes": "Клиенты", "n_seed": "Seed",
                     "sum_kzt_internal": st.column_config.NumberColumn("Внутренний объём, KZT", format="localized"),
                 })
    cluster_id = st.selectbox("Состав кластера", sorted(result.clusters.cluster_id), key="cluster_detail")
    cluster = result.clusters.set_index("cluster_id").loc[cluster_id]
    st.caption(cluster.hypothesis)
    client_table(rows.loc[rows.cluster_id.eq(cluster_id)], f"members_{dataset_id}_{cluster_id}", height=300)


def render_data(result):
    st.subheader("Результаты расчёта")
    st.caption(f"Расчёт: {result.manifest['seconds']:.2f} с · все экспорты содержат полный результат, без фильтров интерфейса")
    downloads = st.columns(3)
    for column, (filename, data) in zip(downloads, [("nodes_roles.csv", result.roles), ("clusters.csv", result.clusters), ("top_nodes.csv", result.top)]):
        column.download_button(filename, data.to_csv(index=False).encode("utf-8-sig"), file_name=filename,
                               mime="text/csv", icon=":material/download:", width="stretch")
    st.subheader("Источники и воспроизводимость")
    sources = pd.DataFrame([
        {"Файл": f"{name}.parquet", "Строки": count, "SHA-256": result.manifest["sha256"][name]}
        for name, count in (("nodes", len(result.roles)), ("edges", len(result.edges)), ("transactions", len(result.transactions)))
    ])
    st.dataframe(sources, hide_index=True, width="stretch")
    st.download_button("Манифест расчёта", json.dumps(result.manifest, indent=2, ensure_ascii=False).encode(),
                       file_name="manifest.json", mime="application/json", icon=":material/download:")
    with st.expander("Параметры модели ролей"):
        st.dataframe(pd.DataFrame(result.manifest["config"].items(), columns=["Параметр", "Значение"]), hide_index=True, width="stretch")
    with st.expander("Границы интерпретации", expanded=True):
        st.write("Роли и приоритеты являются гипотезами. Истинных меток для оценки точности нет. "
                 "Граница обхода ограничена четвёртым коленом; отсутствие видимого выхода не означает окончания потока. "
                 "Входящие seed могут быть неполны. Дневная гранулярность не устанавливает порядок переводов.")
        st.caption("Локальный исследовательский инструмент. Не заменяет проверку аналитиком и банковский контроль доступа.")


def render_workspace(result, analysis_key):
    dataset_id = hashlib.sha256(repr(analysis_key).encode()).hexdigest()[:12]
    if st.session_state.get("view_dataset_key") != analysis_key:
        reset_filters()
        st.session_state.cluster_detail = int(result.clusters.cluster_id.min())
        st.session_state.view_dataset_key = analysis_key
    chat_key = (AI_POLICY_VERSION, analysis_key)
    if st.session_state.get("chat_dataset_key") != chat_key:
        st.session_state.node_chats = {}
        st.session_state.chat_dataset_key = chat_key
    rows = client_rows(result)
    overview, client, clusters, data = st.tabs(["Обзор", "Клиент", "Кластеры", "Данные"], key="workspace", on_change="rerun")
    with overview:
        render_overview(result, rows, dataset_id)
    with client:
        render_client(result, rows, analysis_key, dataset_id)
    with clusters:
        render_clusters(result, rows, dataset_id)
    with data:
        render_data(result)
