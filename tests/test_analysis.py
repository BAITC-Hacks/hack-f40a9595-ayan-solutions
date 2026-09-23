import json
from pathlib import Path

import networkx as nx
import pandas as pd
import pytest

from analysis import build_graph, classify, compute_features, find_clusters, load_data, run_pipeline


CONFIG = json.loads(Path(__file__).resolve().parents[1].joinpath("config.json").read_text())


def test_boundary_seed_and_isolate():
    nodes = pd.DataFrame({
        "gid": [1, 2, 3, 4, 5],
        "depth": [0, 1, 4, 0, 1],
        "is_seed": [True, False, False, True, False],
    })
    edges = pd.DataFrame({
        "src": [1, 2, 5], "dst": [2, 3, 2],
        "sum_kzt": [100000.0, 90000.0, 10000.0], "n_tx": [1, 1, 1], "depth": [1, 2, 1],
    })
    graph = build_graph(nodes, edges)
    clusters = find_clusters(graph, CONFIG)
    features = compute_features(graph, nodes, clusters, CONFIG)
    roles = classify(features, CONFIG).set_index("gid")
    assert graph.number_of_nodes() == 5
    assert roles.loc[3, "role"] != "terminal"
    assert roles.loc[4, "role"] == "peripheral"
    assert roles.loc[4, "priority_score"] == 0
    assert roles.loc[2, "role"] == "transit"
    assert roles.loc[1, "role"] != "transit"


def test_real_dataset_contract_and_repeatability(tmp_path):
    root = Path(__file__).resolve().parents[1]
    first = run_pipeline(root / "data", tmp_path / "first")
    second = run_pipeline(root / "data", tmp_path / "second")
    assert len(first.roles) == 2248
    assert len(first.edges) == 3119
    assert len(first.transactions) == 4840
    assert len(first.top) >= 20
    assert first.roles.equals(second.roles)
    assert first.clusters.equals(second.clusters)
    assert first.top.equals(second.top)
    assert (first.features.truncated_by_depth.sum()) == 444
    assert nx.number_weakly_connected_components(first.graph) == 35
    assert set(first.roles.gid) == set(pd.read_parquet(root / "data" / "nodes.parquet").gid)
    assert first.roles.evidence.str.len().between(1, 200).all()
    for name in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv"):
        assert (tmp_path / "first" / name).is_file()


def test_changed_valid_dataset_recomputes_all_exports(tmp_path):
    root = Path(__file__).resolve().parents[1]
    baseline = run_pipeline(root / "data", tmp_path / "baseline")
    changed_input = tmp_path / "changed_input"
    changed_input.mkdir()
    frames = {name: pd.read_parquet(root / "data" / f"{name}.parquet") for name in ("nodes", "edges", "transactions")}
    edges, transactions = frames["edges"], frames["transactions"]

    top_gid = int(baseline.top.iloc[0].gid)
    edge_index = edges.loc[edges.dst.eq(top_gid), "sum_kzt"].idxmax()
    src = int(edges.loc[edge_index, "src"])
    roles = baseline.roles.set_index("gid")
    assert roles.loc[src, "role"] == "distributor"
    assert roles.loc[src, "cluster_id"] == roles.loc[top_gid, "cluster_id"]

    delta = 10_000
    edges.loc[edge_index, "sum_kzt"] += delta
    transaction_index = transactions.index[transactions.src.eq(src) & transactions.dst.eq(top_gid)][0]
    transactions.loc[transaction_index, "sum_kzt"] += delta
    transactions["date"] = (pd.to_datetime(transactions.date) + pd.DateOffset(months=1)).dt.strftime("%Y-%m-%d")
    for name, frame in frames.items():
        frame.to_parquet(changed_input / f"{name}.parquet", index=False)

    changed = run_pipeline(changed_input, tmp_path / "changed_exports")
    assert changed.transactions.date.min().date().isoformat() == "2026-08-01"
    before_in = baseline.features.set_index("gid").loc[top_gid, "in_kzt"]
    after_in = changed.features.set_index("gid").loc[top_gid, "in_kzt"]
    assert after_in == before_in + delta
    for name in ("nodes_roles.csv", "clusters.csv", "top_nodes.csv"):
        assert (tmp_path / "baseline" / name).read_bytes() != (tmp_path / "changed_exports" / name).read_bytes()


def test_mismatched_transaction_amount_rejected(tmp_path):
    root = Path(__file__).resolve().parents[1]
    for name in ("nodes", "edges", "transactions"):
        frame = pd.read_parquet(root / "data" / f"{name}.parquet")
        if name == "transactions":
            frame.loc[0, "sum_kzt"] += 100
        frame.to_parquet(tmp_path / f"{name}.parquet")
    with pytest.raises(ValueError, match="disagree"):
        load_data(tmp_path)


def test_missing_file_does_not_create_exports(tmp_path):
    with pytest.raises(ValueError, match="Missing input file: nodes.parquet"):
        run_pipeline(tmp_path / "inputs", tmp_path / "exports")
    assert not (tmp_path / "exports").exists()


def test_missing_required_column_rejected(tmp_path):
    root = Path(__file__).resolve().parents[1]
    for name in ("nodes", "edges", "transactions"):
        frame = pd.read_parquet(root / "data" / f"{name}.parquet")
        if name == "edges":
            frame = frame.drop(columns="n_tx")
        frame.to_parquet(tmp_path / f"{name}.parquet")
    with pytest.raises(ValueError, match="edges.parquet lacks columns: n_tx"):
        load_data(tmp_path)
