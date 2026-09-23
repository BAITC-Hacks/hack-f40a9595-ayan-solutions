"""Shared presentation and client selection for the analyst workspace."""

import hashlib
from html import escape

import streamlit as st

from graph_view import ROLE_COLORS


ROLE_LABELS = {
    "coordinator": "Координатор", "consolidator": "Консолидатор",
    "transit": "Транзит", "distributor": "Распределитель",
    "terminal": "Конечный получатель", "peripheral": "Периферийный",
}


def number(value, decimals=0):
    return f"{value:,.{decimals}f}".replace(",", " ")


def client_rows(result):
    return result.roles.merge(
        result.features[["gid", "in_kzt", "out_kzt", "depth", "is_seed"]], on="gid", validate="one_to_one"
    ).sort_values(["priority_score", "gid"], ascending=[False, True]).reset_index(drop=True)


def filter_clients(frame, *, scope="Топ-50", role="Все роли", cluster="Все кластеры", query=""):
    filtered = frame.head(50) if scope == "Топ-50" else frame
    if role != "Все роли":
        filtered = filtered.loc[filtered.role.eq(role)]
    if cluster != "Все кластеры":
        filtered = filtered.loc[filtered.cluster_id.eq(cluster)]
    if query.strip():
        filtered = filtered.loc[filtered.gid.astype(str).str.contains(query.strip(), regex=False)]
    return filtered.copy()


def activate_client(gid):
    st.session_state["gid_query"] = str(gid)
    st.session_state["workspace"] = "Клиент"


def client_table(frame, key, height=390):
    columns = (["gid", "role", "sum_kzt", "n_tx"] if "sum_kzt" in frame
               else ["gid", "role", "priority_score", "in_kzt", "out_kzt", "cluster_id"])
    display = frame[columns].copy()
    display["gid"] = display.gid.astype(str)
    display["role"] = display.role.map(ROLE_LABELS)
    identity = hashlib.sha256(
        "|".join(display.gid).encode()
    ).hexdigest()[:12]
    table_key = f"{key}_{identity}"

    def choose_client():
        rows = st.session_state[table_key]["selection"]["rows"]
        if rows and 0 <= rows[0] < len(frame):
            activate_client(int(frame.iloc[rows[0]].gid))
            st.session_state[table_key] = {"selection": {"rows": [], "columns": [], "cells": []}}

    return st.dataframe(
        display, key=table_key, hide_index=True, width="stretch", height=height,
        on_select=choose_client, selection_mode="single-row", row_height=36,
        column_config={
            "gid": st.column_config.TextColumn("Клиент · GID", width=185),
            "role": st.column_config.TextColumn("Гипотеза роли", width=160),
            "priority_score": st.column_config.ProgressColumn(
                "Приоритет", min_value=0, max_value=1, format="%.3f", width=100,
                help="Эвристическая очередность проверки, не вероятность нарушения.",
            ),
            "in_kzt": st.column_config.NumberColumn("Вход, KZT", format="localized", width=125),
            "out_kzt": st.column_config.NumberColumn("Выход, KZT", format="localized", width=125),
            "cluster_id": st.column_config.NumberColumn("Кластер", format="%d", width="small"),
            "sum_kzt": st.column_config.NumberColumn("Объём связи, KZT", format="localized", width="medium"),
            "n_tx": st.column_config.NumberColumn("Переводы", format="%d", width="small"),
        },
    )


def role_badge(role):
    return f'<span class="role-label"><i style="background:{ROLE_COLORS[role]}"></i>{escape(ROLE_LABELS[role])}</span>'


def show_legend():
    st.markdown('<div class="role-legend">' + "".join(role_badge(role) for role in ROLE_LABELS) + '</div>', unsafe_allow_html=True)
