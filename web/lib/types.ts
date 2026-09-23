export type RoleCode =
  | "coordinator"
  | "distributor"
  | "transit"
  | "consolidator"
  | "terminal"
  | "peripheral";
export type Gid = string;
export type KztDecimal = string;
export interface NodeSummary {
  incoming_kzt?: string;
  outgoing_kzt?: string;
  unique_senders?: number;
  unique_receivers?: number;
  gid: Gid;
  role: RoleCode;
  role_score: number;
  cluster_id: number;
  priority_score: number;
  evidence: string;
  depth: number;
  is_seed: boolean;
  rank: number;
}
export interface EvidenceRule {
  code: string;
  label: string;
  observed: number | string | null;
  operator: string | null;
  threshold: number | string | null;
  matched: boolean;
  explanation: string;
}
export interface NodeDetail extends NodeSummary {
  run_id: string;
  incoming_kzt: KztDecimal;
  outgoing_kzt: KztDecimal;
  unique_senders: number;
  unique_receivers: number;
  in_tx: number;
  out_tx: number;
  observed_out_in_ratio: number | null;
  warnings: { code: string; message: string }[];
  role_rules: EvidenceRule[];
  priority_explanation: string;
  priority_factors: {
    label: string;
    normalized: number;
    weight: number;
    contribution: number;
  }[];
}
export interface GraphEdge {
  id: string;
  source: Gid;
  target: Gid;
  sum_kzt: KztDecimal;
  n_tx: number;
  width: number;
}
export interface GraphData {
  run_id: string;
  dataset_id: string;
  nodes: NodeSummary[];
  edges: GraphEdge[];
  positions: Record<Gid, { x: number; y: number }>;
}
export interface Run {
  run_id: string | null;
  dataset_id: string;
  status: "empty" | "queued" | "running" | "completed" | "failed";
  stage?: string;
  error?: string;
  started_at: string;
  seconds: number;
  version: string;
  rows: { nodes: number; edges: number; transactions: number };
  period: { from: string; to: string };
  n_seed: number;
  n_boundary: number;
  n_isolates: number;
  n_components: number;
  components: number[];
  n_clusters: number;
  total_kzt: KztDecimal;
  role_counts: Record<RoleCode, number>;
  warnings: string[];
  artifacts: { name: string; rows: number }[];
  checks: Record<string, boolean>;
  sha256: Record<string, string>;
  config: Record<string, number>;
  capabilities: Record<string, boolean>;
  ai_status: "configured" | "not_configured";
}
export interface Cluster {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: KztDecimal;
  n_edges_internal: number;
  incoming_external_kzt: KztDecimal;
  outgoing_external_kzt: KztDecimal;
  top_gids: Gid[];
  hypothesis: string;
  method: string;
  members?: NodeSummary[];
  role_counts?: Record<RoleCode, number>;
  cross_cluster?: {
    cluster_id: number;
    direction: string;
    n_edges: number;
    sum_kzt: KztDecimal;
  }[];
}
export interface Paged<T> {
  run_id: string;
  items: T[];
  total: number;
}
export interface Transaction {
  source: Gid;
  target: Gid;
  date: string;
  sum_kzt: KztDecimal;
  reference: string;
  direction: string;
}
export interface Connection extends GraphEdge {
  gid: Gid;
  role: RoleCode;
  direction: string;
}
export interface EdgeDetail extends GraphEdge {
  source_role: RoleCode;
  target_role: RoleCode;
  transactions: Paged<Transaction>;
}
export interface AIResponse {
  dialogue?: {
    question: string;
    answer: {
      answer: string;
      evidence_refs: string[];
      related_gids: string[];
      limitations: string[];
    };
  };
  run_id: string;
  gid: Gid;
  mode: "rules" | "llm";
  cached: boolean;
  evidence_version: string;
  interpretation: string;
  facts: { key: string; label: string; value: unknown }[];
  counterarguments: string[];
  next_check: string;
  references: Gid[];
  preparation: string[];
}
export interface Methodology {
  run_id: string;
  version: string;
  config: Record<string, number>;
  limits: string[];
  role_order: RoleCode[];
  examples: Partial<Record<RoleCode, EvidenceRule[]>>;
  priority: string;
  normalization: string;
  role_score: string;
  clustering: string;
  geometry: string;
  self_loops: string;
  scaling: string;
  schemas: Record<string, string[]>;
}
