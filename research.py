"""Bounded structural experiments. Never mutate the analytical result."""
import time
import networkx as nx


def simulate_removal(graph: nx.DiGraph, gid: int, timeout=5):
    if gid not in graph:
        raise ValueError("Узел не найден в этом анализе.")
    if len(graph) > 50000:
        raise ValueError("Локальный эксперимент ограничен пятьюдесятью тысячами узлов.")
    started = time.monotonic()
    surviving = set(graph) - {gid}
    sources = sorted(n for n in surviving if graph.nodes[n].get("is_seed", False))
    after = graph.copy()
    after.remove_node(gid)
    before_count = after_count = 0
    lost_targets = set()
    for source in sources:
        if time.monotonic() - started > timeout:
            raise TimeoutError("Превышено время структурного эксперимента.")
        before_targets = nx.descendants(graph, source) & surviving
        after_targets = nx.descendants(after, source) & surviving
        before_count += len(before_targets)
        after_count += len(after_targets)
        lost_targets.update(before_targets - after_targets)
    return {
        "removed_gid": str(gid), "sources": [str(n) for n in sources],
        "n_sources": len(sources), "n_targets": len(surviving),
        "before_pairs": before_count, "after_pairs": after_count,
        "lost_pairs": before_count - after_count,
        "loss_ratio": (before_count-after_count)/before_count if before_count else None,
        "affected_targets": len(lost_targets), "lost_target_gids": [str(n) for n in sorted(lost_targets)],
        "before_nodes": len(graph), "after_nodes": len(after),
        "before_edges": graph.number_of_edges(), "after_edges": after.number_of_edges(),
        "seconds": round(time.monotonic()-started, 4),
        "method": "Источники: surviving seed, кроме удаляемого узла. Цели: все surviving узлы, кроме удаляемого. Пары source=target исключены. Наборы одинаковы до/после; считаются достижимые направленные пары на полном графе, не все пути.",
        "limitation": "Структурный эксперимент на копии наблюдаемого графа. Не блокировка счетов и не прогноз финансового эффекта.",
    }
