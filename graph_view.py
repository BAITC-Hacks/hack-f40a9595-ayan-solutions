"""A bounded, self-contained view of a selected node's directed neighborhood."""

import math

from pyvis.network import Network


ROLE_COLORS = {
    "coordinator": "#c63f35",
    "consolidator": "#ad692c",
    "transit": "#2678a5",
    "distributor": "#7b55a3",
    "terminal": "#4c8a58",
    "peripheral": "#818b90",
}
CLUSTER_COLORS = ["#397ba2", "#bd6138", "#649b5b", "#9767a1", "#c39b3b", "#5c918d", "#b65b77"]


def render_neighborhood(result, gid, color_by="role", limit=170):
    graph = result.graph
    if gid not in graph:
        raise ValueError(f"GID {gid} отсутствует в данных")
    rows = result.roles.set_index("gid")
    adjacent = []
    for source, target, attrs in graph.in_edges(gid, data=True):
        adjacent.append((float(attrs["sum_kzt"]), source))
    for source, target, attrs in graph.out_edges(gid, data=True):
        adjacent.append((float(attrs["sum_kzt"]), target))
    adjacent.sort(key=lambda item: (-item[0], item[1]))
    selected = {gid}
    for _, neighbor in adjacent:
        selected.add(neighbor)
        if len(selected) >= limit:
            break
    # Include visible ties between displayed neighbors, keeping the drawing bounded.
    net = Network(height="570px", width="100%", directed=True, bgcolor="#ffffff", font_color="#27333b", cdn_resources="in_line")
    net.set_options('''{"physics":{"enabled":true,"stabilization":{"iterations":140}},"interaction":{"hover":true,"navigationButtons":true},"edges":{"smooth":{"type":"dynamic"},"arrows":{"to":{"enabled":true,"scaleFactor":0.75}},"color":{"color":"#a7b2b8"}},"nodes":{"font":{"face":"Arial","size":13}}}''')
    for node in sorted(selected):
        row = rows.loc[node]
        color = ROLE_COLORS[row.role] if color_by == "role" else CLUSTER_COLORS[int(row.cluster_id) % len(CLUSTER_COLORS)]
        net.add_node(str(node), label=str(node) if node == gid else " ", title=f"GID {node} | {row.role} | приоритет {row.priority_score:.3f}", color=color,
                     size=31 if node == gid else 13 + 19 * float(row.priority_score), borderWidth=3 if node == gid else 1,
                     shape="dot")
    visible_edges = sorted(((u, v, a) for u, v, a in graph.edges(data=True) if u in selected and v in selected), key=lambda x: (x[0], x[1]))
    for source, target, attrs in visible_edges:
        amount = float(attrs["sum_kzt"])
        net.add_edge(str(source), str(target), title=f"{amount:,.0f} KZT; {attrs['n_tx']} переводов", width=min(7, 1 + math.log10(max(amount, 1)) / 2))
    return net.generate_html(), len(selected), len(visible_edges), len(set(graph.predecessors(gid)) | set(graph.successors(gid))) - (len(selected) - 1)
