"""Deterministic, explainable analysis of the observed transfer graph."""

from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd


ROLES = {"consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral"}
ROLE_COLUMNS = ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"]
CLUSTER_COLUMNS = ["cluster_id", "n_nodes", "n_seed", "sum_kzt_internal", "top_gids", "hypothesis"]
TOP_COLUMNS = ["rank", "gid", "role", "priority_score", "why"]


@dataclass
class Result:
    graph: nx.DiGraph
    features: pd.DataFrame
    roles: pd.DataFrame
    clusters: pd.DataFrame
    top: pd.DataFrame
    edges: pd.DataFrame
    transactions: pd.DataFrame
    manifest: dict


def load_data(data_dir: Path):
    required = {
        "nodes": {"gid", "depth", "is_seed"},
        "edges": {"src", "dst", "sum_kzt", "n_tx", "depth"},
        "transactions": {"src", "dst", "date", "sum_kzt"},
    }
    tables = {}
    for name, columns in required.items():
        path = data_dir / f"{name}.parquet"
        if not path.is_file():
            raise ValueError(f"Missing input file: {path.name}")
        try:
            tables[name] = pd.read_parquet(path)
        except Exception as exc:
            raise ValueError(f"Cannot read {path.name}: {exc}") from exc
        missing = columns - set(tables[name].columns)
        if missing:
            raise ValueError(f"{path.name} lacks columns: {', '.join(sorted(missing))}")
    nodes, edges, tx = (tables[key].copy() for key in required)
    for name, frame, columns in [
        ("nodes", nodes, required["nodes"]),
        ("edges", edges, required["edges"]),
        ("transactions", tx, required["transactions"]),
    ]:
        if frame.empty or frame[list(columns)].isna().any().any():
            raise ValueError(f"{name}.parquet is empty or has missing required values")
    for name, frame, columns in [
        ("nodes", nodes, ["gid", "depth"]),
        ("edges", edges, ["src", "dst", "n_tx", "depth"]),
        ("transactions", tx, ["src", "dst"]),
    ]:
        for column in columns:
            values = pd.to_numeric(frame[column], errors="coerce")
            if not np.isfinite(values.to_numpy(dtype=float)).all() or not (values == np.floor(values)).all():
                raise ValueError(f"{name}.{column} must contain finite integers")
            frame[column] = values.astype("int64")
    if nodes.gid.duplicated().any() or edges.duplicated(["src", "dst"]).any():
        raise ValueError("nodes.gid and edges (src,dst) must be unique")
    if not nodes.depth.between(0, 4).all() or not edges.depth.between(1, 4).all():
        raise ValueError("depth must be between 0 and 4")
    if not nodes.is_seed.isin([True, False]).all():
        raise ValueError("is_seed must be boolean")
    if not set(edges.src).union(edges.dst).issubset(set(nodes.gid)):
        raise ValueError("edges refer to a gid absent from nodes")
    for name, frame in [("edges", edges), ("transactions", tx)]:
        frame["sum_kzt"] = pd.to_numeric(frame.sum_kzt, errors="coerce")
        if not np.isfinite(frame.sum_kzt.to_numpy()).all() or (frame.sum_kzt <= 0).any():
            raise ValueError(f"{name}.sum_kzt must be finite and positive")
    if (edges.n_tx <= 0).any():
        raise ValueError("edges.n_tx must be positive")
    try:
        tx["date"] = pd.to_datetime(tx.date, errors="raise")
    except Exception as exc:
        raise ValueError("transactions.date contains invalid dates") from exc
    if tx.date.isna().any():
        raise ValueError("transactions.date contains missing dates")
    aggregate = tx.groupby(["src", "dst"], as_index=False).agg(total=("sum_kzt", "sum"), count=("sum_kzt", "size"))
    check = edges.merge(aggregate, on=["src", "dst"], how="outer", indicator=True)
    if not (check["_merge"] == "both").all():
        raise ValueError("edges and transactions have different transfer pairs")
    if not (check.n_tx == check["count"]).all() or not np.allclose(check.sum_kzt, check.total, rtol=1e-9, atol=1e-6):
        raise ValueError("edges sums/counts disagree with transactions")
    return nodes.sort_values("gid"), edges.sort_values(["src", "dst"]), tx


def build_graph(nodes, edges):
    graph = nx.DiGraph()
    for row in nodes.itertuples(index=False):
        graph.add_node(int(row.gid), depth=int(row.depth), is_seed=bool(row.is_seed))
    for row in edges.itertuples(index=False):
        graph.add_edge(int(row.src), int(row.dst), sum_kzt=float(row.sum_kzt), n_tx=int(row.n_tx))
    return graph


def percentile(values):
    series = pd.Series(values, dtype=float)
    result = pd.Series(0.0, index=series.index)
    positive = series.gt(0) & np.isfinite(series)
    if positive.any():
        result.loc[positive] = series.loc[positive].rank(method="average", pct=True)
    return result


def find_clusters(graph, config):
    projection = nx.Graph()
    projection.add_nodes_from(sorted(graph.nodes))
    for src, dst, attrs in sorted(graph.edges(data=True)):
        if projection.has_edge(src, dst):
            projection[src][dst]["weight"] += attrs["sum_kzt"]
        else:
            projection.add_edge(src, dst, weight=attrs["sum_kzt"])
    communities = nx.community.louvain_communities(projection, weight="weight", seed=config["random_seed"])
    communities = sorted(communities, key=lambda group: min(group))
    return {gid: index for index, group in enumerate(communities) for gid in group}


def compute_features(graph, nodes, clusters, config):
    features = nodes[["gid", "depth", "is_seed"]].copy().set_index("gid")
    features["in_deg"] = pd.Series(dict(graph.in_degree()), dtype=int)
    features["out_deg"] = pd.Series(dict(graph.out_degree()), dtype=int)
    features["in_kzt"] = pd.Series(dict(graph.in_degree(weight="sum_kzt")), dtype=float)
    features["out_kzt"] = pd.Series(dict(graph.out_degree(weight="sum_kzt")), dtype=float)
    features["in_tx"] = pd.Series(dict(graph.in_degree(weight="n_tx")), dtype=int)
    features["out_tx"] = pd.Series(dict(graph.out_degree(weight="n_tx")), dtype=int)
    features["cluster_id"] = pd.Series(clusters, dtype=int)
    features["pagerank"] = pd.Series(nx.pagerank(graph, weight="sum_kzt"))
    features["pass_through"] = features.out_kzt.div(features.in_kzt.replace(0, np.nan))
    features["truncated_by_depth"] = features.depth.eq(4) & features.out_deg.eq(0)
    reach = {gid: 0 for gid in graph}
    for seed in sorted(nodes.loc[nodes.is_seed, "gid"]):
        reached = nx.descendants(graph, int(seed))
        for gid in reached:
            if gid != seed:
                reach[gid] += 1
    features["seed_reach"] = pd.Series(reach)
    if graph.number_of_edges():
        sample = min(config["betweenness_sample"], graph.number_of_nodes())
        between = nx.betweenness_centrality(graph, k=sample, weight=None, seed=config["random_seed"])
    else:
        between = {gid: 0.0 for gid in graph}
    features["betweenness"] = pd.Series(between)
    features["other_clusters"] = pd.Series({
        gid: len({clusters[other] for other in set(graph.predecessors(gid)) | set(graph.successors(gid)) if clusters[other] != clusters[gid]})
        for gid in graph
    })
    for name in ["seed_reach", "in_kzt", "in_deg", "out_deg", "betweenness", "pagerank"]:
        features[f"p_{name}"] = percentile(features[name])
    features["priority_score"] = (
        0.30 * features.p_seed_reach
        + 0.25 * features.p_in_kzt
        + 0.20 * features[["p_in_deg", "p_out_deg"]].max(axis=1)
        + 0.15 * features.p_betweenness
        + 0.10 * features.p_pagerank
    ).clip(0, 1)
    features.loc[features.in_deg.eq(0) & features.out_deg.eq(0), "priority_score"] = 0.0
    return features.reset_index()


def classify(features, config):
    records = []
    for row in features.itertuples(index=False):
        ratio = row.pass_through
        isolated = row.in_deg == 0 and row.out_deg == 0
        if (row.seed_reach >= config["coordinator_seed_reach"] and row.in_deg > 0 and row.out_deg > 0
                and row.p_betweenness >= config["coordinator_betweenness_percentile"]
                and row.other_clusters >= config["coordinator_other_clusters"]):
            role = "coordinator"
            score = 0.5 + 0.4 * row.p_betweenness
            evidence = f"Признаки координации: доступен от {row.seed_reach} seed, связей между кластерами {row.other_clusters}; посредничество {row.betweenness:.4f}."
        elif row.out_deg >= config["distributor_out_degree"]:
            role = "distributor"
            score = 0.5 + 0.4 * min(row.out_deg / 30, 1)
            evidence = f"Признаки распределения: {row.out_deg} получателей, {row.out_tx} переводов, исходящие {row.out_kzt:,.0f} KZT."
        elif (not row.is_seed and row.in_deg > 0 and row.out_deg > 0 and not row.truncated_by_depth
              and config["transit_ratio_min"] <= ratio <= config["transit_ratio_max"]):
            role = "transit"
            score = 0.5 + 0.4 * max(0, 1 - abs(ratio - 1) / 0.2)
            evidence = f"Признаки транзита: вход {row.in_kzt:,.0f}, выход {row.out_kzt:,.0f} KZT; наблюдаемое отношение {ratio:.2f}."
        elif row.in_deg >= config["consolidator_in_degree"] and row.in_kzt > 0:
            role = "consolidator"
            score = 0.5 + 0.4 * min(row.in_deg / 10, 1)
            evidence = f"Признаки консолидации: {row.in_deg} плательщиков, вход {row.in_kzt:,.0f} KZT; исходящие {row.out_kzt:,.0f} KZT."
        elif row.in_deg > 0 and row.out_deg == 0 and row.depth < 4 and not row.is_seed:
            role = "terminal"
            score = 0.5 + 0.4 * row.p_in_kzt
            evidence = f"Нет наблюдаемых исходящих; вход от {row.in_deg} плательщиков на {row.in_kzt:,.0f} KZT. Вне выборки потоки неизвестны."
        else:
            role = "peripheral"
            score = 0.0 if isolated else 0.2
            if row.truncated_by_depth:
                evidence = f"Граница 4-го колена: вход {row.in_kzt:,.0f} KZT, исходящие дальше не наблюдаются; роль получателя не доказана."
            else:
                evidence = f"Недостаточно признаков роли: входящих связей {row.in_deg}, исходящих {row.out_deg}, глубина {row.depth}."
        if row.truncated_by_depth:
            score = min(score, 0.6)
            if role != "peripheral":
                evidence += " Выход за 4-м коленом неизвестен."
        records.append((int(row.gid), role, round(score, 6), int(row.cluster_id), round(row.priority_score, 6), evidence))
    return pd.DataFrame(records, columns=ROLE_COLUMNS)


def build_top(features, roles):
    joined = features.drop(columns=["priority_score"]).merge(roles[ROLE_COLUMNS], on=["gid", "cluster_id"], validate="one_to_one")
    ordered = joined.sort_values(["priority_score", "gid"], ascending=[False, True]).head(max(20, min(50, len(joined))))
    result = []
    contributions = {
        "seed": (0.30, "seed_reach", "достижимость от seed"),
        "in": (0.25, "p_in_kzt", "наблюдаемый вход"),
        "degree": (0.20, None, "число связей"),
        "between": (0.15, "p_betweenness", "посредничество"),
        "pr": (0.10, "p_pagerank", "PageRank"),
    }
    for rank, row in enumerate(ordered.itertuples(index=False), 1):
        scores = []
        for name, (weight, column, label) in contributions.items():
            normalized = max(row.p_in_deg, row.p_out_deg) if column is None else getattr(row, column)
            raw = max(row.in_deg, row.out_deg) if name == "degree" else (row.seed_reach if name == "seed" else row.in_kzt if name == "in" else row.betweenness if name == "between" else row.pagerank)
            scores.append((weight * normalized, f"{label} {raw:,.2f}"))
        scores.sort(reverse=True)
        why = f"{row.evidence} Приоритет: {scores[0][1]}; {scores[1][1]}. Граф неполный."
        result.append((rank, int(row.gid), row.role, row.priority_score, why))
    return pd.DataFrame(result, columns=TOP_COLUMNS)


def build_cluster_table(features, roles, edges):
    frame = features.merge(roles[["gid", "role"]], on="gid", validate="one_to_one")
    cluster_of = dict(zip(frame.gid, frame.cluster_id))
    internal = {}
    for edge in edges.itertuples(index=False):
        cid = cluster_of[int(edge.src)]
        if cid == cluster_of[int(edge.dst)]:
            internal[cid] = internal.get(cid, 0.0) + float(edge.sum_kzt)
    records = []
    for cid, group in frame.groupby("cluster_id", sort=True):
        top = group.sort_values(["priority_score", "gid"], ascending=[False, True]).head(5)
        main_role = group.role.value_counts().drop(labels=["peripheral"], errors="ignore")
        if main_role.empty:
            hypothesis = "Недостаточно наблюдаемых структурных признаков; требуется проверка связей."
        else:
            hypothesis = f"Преобладают признаки роли {main_role.index[0]} ({main_role.iloc[0]} узлов); назначение группы требует проверки."
        records.append((int(cid), len(group), int(group.is_seed.sum()), round(internal.get(cid, 0.0), 2), json.dumps([str(gid) for gid in top.gid]), hypothesis))
    return pd.DataFrame(records, columns=CLUSTER_COLUMNS)


def validate_outputs(nodes, roles, clusters, top):
    if set(roles.gid) != set(nodes.gid) or len(roles) != len(nodes) or roles.gid.duplicated().any():
        raise ValueError("roles must contain every input gid exactly once")
    if set(roles.role) - ROLES or roles[ROLE_COLUMNS].isna().any().any():
        raise ValueError("roles contain invalid or missing values")
    if not roles.evidence.map(lambda value: isinstance(value, str) and 0 < len(value) <= 200).all():
        raise ValueError("evidence must be nonempty and at most 200 characters")
    for name in ["role_score", "priority_score"]:
        if not np.isfinite(roles[name]).all() or not roles[name].between(0, 1).all():
            raise ValueError(f"invalid {name}")
    if (clusters.n_nodes.sum() != len(nodes) or clusters.n_seed.sum() != int(nodes.is_seed.sum())
            or set(roles.cluster_id) != set(clusters.cluster_id)):
        raise ValueError("cluster coverage is incomplete")
    if len(top) < min(20, len(nodes)) or top.gid.duplicated().any() or list(top["rank"]) != list(range(1, len(top) + 1)):
        raise ValueError("top ranking is incomplete")
    expected = roles.sort_values(["priority_score", "gid"], ascending=[False, True]).head(len(top))
    if list(top.gid) != list(expected.gid):
        raise ValueError("top ranking order disagrees with roles")
    if not top.merge(roles[["gid", "role", "priority_score"]], on=["gid", "role", "priority_score"]).shape[0] == len(top):
        raise ValueError("top roles/scores disagree with roles export")
    boundary = set(nodes.loc[nodes.depth.eq(4), "gid"])
    if set(roles.loc[roles.role.eq("terminal"), "gid"]) & boundary:
        raise ValueError("depth-4 boundary nodes cannot be terminal")


def run_pipeline(data_dir: Path, out_dir: Path, config_path: Path | None = None):
    started = time.monotonic()
    data_dir, out_dir = Path(data_dir), Path(out_dir)
    if config_path is None:
        config_path = Path(__file__).with_name("config.json")
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    nodes, edges, tx = load_data(data_dir)
    graph = build_graph(nodes, edges)
    clusters_by_gid = find_clusters(graph, config)
    features = compute_features(graph, nodes, clusters_by_gid, config)
    roles = classify(features, config)
    top = build_top(features, roles)
    clusters = build_cluster_table(features, roles, edges)
    validate_outputs(nodes, roles, clusters, top)
    manifest = {
        "rows": {"nodes": len(nodes), "edges": len(edges), "transactions": len(tx)},
        "sha256": {name: hashlib.sha256((data_dir / f"{name}.parquet").read_bytes()).hexdigest() for name in ("nodes", "edges", "transactions")},
        "config": config,
        "seconds": round(time.monotonic() - started, 3),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    roles.to_csv(out_dir / "nodes_roles.csv", index=False)
    clusters.to_csv(out_dir / "clusters.csv", index=False)
    top.to_csv(out_dir / "top_nodes.csv", index=False)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return Result(graph, features, roles, clusters, top, edges, tx, manifest)
