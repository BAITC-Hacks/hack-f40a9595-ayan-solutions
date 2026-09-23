import type { GraphData, NodeSummary, RoleCode } from "./types";
export interface Filters {
  roles: RoleCode[];
  cluster: string;
  depth: number[];
  priority: number;
  seed: boolean;
  boundary: boolean;
}
export const emptyFilters: Filters = {
  roles: [],
  cluster: "",
  depth: [],
  priority: 0,
  seed: false,
  boundary: false,
};
export function filtersFrom(params: URLSearchParams): Filters {
  const roles = params
    .getAll("role")
    .filter((r) =>
      [
        "coordinator",
        "distributor",
        "transit",
        "consolidator",
        "terminal",
        "peripheral",
      ].includes(r),
    ) as RoleCode[];
  return {
    roles,
    cluster: params.get("cluster") || "",
    depth: params
      .getAll("depth")
      .map(Number)
      .filter((d) => d >= 0 && d <= 4),
    priority: Math.min(1, Math.max(0, Number(params.get("priority")) || 0)),
    seed: params.get("seed") === "1",
    boundary: params.get("boundary") === "1",
  };
}
export function matches(n: NodeSummary, f: Filters) {
  return (
    (!f.roles.length || f.roles.includes(n.role)) &&
    (!f.cluster || String(n.cluster_id) === f.cluster) &&
    (!f.depth.length || f.depth.includes(n.depth)) &&
    n.priority_score >= f.priority &&
    (!f.seed || n.is_seed) &&
    (!f.boundary || n.depth === 4)
  );
}
export function visibleNodes(
  graph: GraphData,
  filters: Filters,
  mode: string,
  anchor: string,
  hops: number,
  direction: string,
  external = false,
): Set<string> {
  if (mode === "neighborhood" && anchor) {
    const visited = new Set([anchor]);
    let frontier = new Set([anchor]);
    for (let hop = 0; hop < hops; hop++) {
      const next = new Set<string>();
      for (const edge of graph.edges) {
        if (
          direction !== "in" &&
          frontier.has(edge.source) &&
          !visited.has(edge.target)
        )
          next.add(edge.target);
        if (
          direction !== "out" &&
          frontier.has(edge.target) &&
          !visited.has(edge.source)
        )
          next.add(edge.source);
      }
      next.forEach((gid) => visited.add(gid));
      frontier = next;
    }
    return visited;
  }
  const ids = new Set(
    graph.nodes.filter((n) => matches(n, filters)).map((n) => n.gid),
  );
  if (external) {
    const original = new Set(ids);
    graph.edges.forEach((e) => {
      if (original.has(e.source) || original.has(e.target)) {
        ids.add(e.source);
        ids.add(e.target);
      }
    });
  }
  return ids;
}
