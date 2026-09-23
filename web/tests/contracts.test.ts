import { describe, it, expect } from "vitest";
import { money, roles } from "../lib/utils";
import {
  emptyFilters,
  filtersFrom,
  matches,
  visibleNodes,
} from "../lib/view-state";
import type { GraphData, NodeSummary } from "../lib/types";
const node = (
  gid: string,
  role: NodeSummary["role"] = "peripheral",
  depth = 1,
): NodeSummary => ({
  gid,
  role,
  depth,
  role_score: 0.2,
  cluster_id: 0,
  priority_score: 0.4,
  evidence: "Test fixture",
  is_seed: false,
  rank: 1,
});
const graph: GraphData = {
  run_id: "test-only",
  dataset_id: "test-only",
  nodes: [
    node("90071992547409931"),
    node("90071992547409932", "transit"),
    node("90071992547409933", "terminal", 4),
    node("90071992547409934"),
  ],
  edges: [
    {
      id: "a",
      source: "90071992547409931",
      target: "90071992547409932",
      sum_kzt: "12.34",
      n_tx: 1,
      width: 2,
    },
    {
      id: "b",
      source: "90071992547409932",
      target: "90071992547409933",
      sum_kzt: "56.78",
      n_tx: 1,
      width: 3,
    },
  ],
  positions: {},
};
describe("Exact presentation", () => {
  it("formats beyond Number.MAX_SAFE_INTEGER without losing cents", () =>
    expect(money("90071992547409931.27").replace(/\s/g, " ")).toBe(
      "90 071 992 547 409 931,27 ₸",
    ));
  it("uses one complete role dictionary", () =>
    expect(Object.keys(roles)).toHaveLength(6));
  it("clamps invalid view priority and preserves depth four", () =>
    expect(
      filtersFrom(new URLSearchParams("priority=8&depth=4&role=fake")),
    ).toMatchObject({ priority: 1, depth: [4], roles: [] }));
});
describe("Graph view is not the scoring model", () => {
  it("retains isolated nodes in the full view", () =>
    expect(visibleNodes(graph, emptyFilters, "all", "", 1, "all").size).toBe(
      4,
    ));
  it("combines roles by OR and categories by AND", () =>
    expect(
      graph.nodes
        .filter((n) =>
          matches(n, {
            ...emptyFilters,
            roles: ["transit", "terminal"],
            depth: [4],
          }),
        )
        .map((n) => n.gid),
    ).toEqual(["90071992547409933"]));
  it("uses directed hops, not depth", () => {
    expect([
      ...visibleNodes(
        graph,
        emptyFilters,
        "neighborhood",
        "90071992547409931",
        1,
        "out",
      ),
    ]).toHaveLength(2);
    expect([
      ...visibleNodes(
        graph,
        emptyFilters,
        "neighborhood",
        "90071992547409931",
        2,
        "out",
      ),
    ]).toHaveLength(3);
    expect([
      ...visibleNodes(
        graph,
        emptyFilters,
        "neighborhood",
        "90071992547409931",
        3,
        "in",
      ),
    ]).toEqual(["90071992547409931"]);
  });
  it("temporary neighborhood exposes a filtered node without mutating filters", () => {
    const f = { ...emptyFilters, roles: ["terminal"] as NodeSummary["role"][] };
    expect(
      visibleNodes(graph, f, "neighborhood", "90071992547409931", 1, "all").has(
        "90071992547409931",
      ),
    ).toBe(true);
    expect(f.roles).toEqual(["terminal"]);
  });
});
