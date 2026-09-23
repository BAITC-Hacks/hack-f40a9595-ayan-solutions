import networkx as nx
import pytest
from research import simulate_removal


def test_surviving_endpoints_and_original_graph_are_identical():
    graph = nx.DiGraph([(1, 2), (2, 3), (4, 3)])
    graph.nodes[1]["is_seed"] = True
    graph.nodes[4]["is_seed"] = True
    original = nx.node_link_data(graph)
    result = simulate_removal(graph, 2)
    assert result["sources"] == ["1", "4"]
    assert result["n_targets"] == 3
    assert result["before_pairs"] == 2  # 1->3 and 4->3; removed target 2 excluded.
    assert result["after_pairs"] == 1
    assert result["loss_ratio"] == .5
    assert result["lost_target_gids"] == ["3"]
    assert result["before_nodes"] - result["after_nodes"] == 1
    assert nx.node_link_data(graph) == original


def test_removed_seed_is_not_a_baseline_source_and_zero_is_undefined():
    graph = nx.DiGraph([(1, 2), (2, 3)])
    graph.nodes[1]["is_seed"] = True
    result = simulate_removal(graph, 1)
    assert result["sources"] == []
    assert result["before_pairs"] == result["after_pairs"] == 0
    assert result["loss_ratio"] is None


def test_alternate_path_preserves_reachability():
    graph = nx.DiGraph([(1, 2), (2, 4), (1, 3), (3, 4)])
    graph.nodes[1]["is_seed"] = True
    result = simulate_removal(graph, 2)
    assert result["before_pairs"] == result["after_pairs"] == 2
    assert result["affected_targets"] == 0


def test_unknown_and_timeout_are_explicit():
    graph = nx.DiGraph([(1, 2)])
    graph.nodes[1]["is_seed"] = True
    with pytest.raises(ValueError):
        simulate_removal(graph, 99)
    with pytest.raises(TimeoutError):
        simulate_removal(graph, 2, timeout=-1)
