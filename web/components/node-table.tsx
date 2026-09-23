"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownWideNarrow } from "lucide-react";
import type { NodeSummary } from "@/lib/types";
import { score } from "@/lib/utils";
import { Gid, RoleBadge, Pagination, ExportButton } from "./common";
export default function NodeTable({
  nodes,
  selected,
  onSelect,
  run,
  priority = false,
  visible,
}: {
  nodes: NodeSummary[];
  selected: string;
  onSelect: (gid: string) => void;
  run: string;
  priority?: boolean;
  visible?: Set<string>;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [sort, setSort] = useState("priority");
  const [local, setLocal] = useState(false);
  const rows = useMemo(
    () =>
      nodes
        .filter((n) => !local || !visible || visible.has(n.gid))
        .sort((a, b) =>
          sort === "gid"
            ? BigInt(a.gid) < BigInt(b.gid)
              ? -1
              : 1
            : sort === "role"
              ? a.role.localeCompare(b.role) || a.rank - b.rank
              : a.rank - b.rank,
        ),
    [nodes, sort, local, visible],
  );
  useEffect(() => setPage(1), [nodes, local, sort, size]);
  return (
    <section className="node-table">
      <header className="table-heading">
        <h2>
          {priority ? "Приоритеты для проверки" : "Узлы сети"}{" "}
          <span className="muted">{rows.length}</span>
        </h2>
        <div className="table-actions">
          {visible && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={local}
                onChange={(e) => setLocal(e.target.checked)}
              />
              Только видимые
            </label>
          )}
          <label className="sort-label">
            <ArrowDownWideNarrow size={15} />
            <select
              aria-label="Сортировка узлов"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="priority">Приоритет</option>
              <option value="gid">GID</option>
              <option value="role">Роль</option>
            </select>
          </label>
          {priority && (
            <ExportButton run={run} name="top_nodes.csv" label="CSV" />
          )}
        </div>
      </header>
      {priority && nodes.length < 20 && (
        <p className="notice">
          В анализе меньше двадцати узлов; показаны все уникальные записи.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Место</th>
              <th>GID</th>
              <th>Роль</th>
              <th className="numeric">Приоритет</th>
              {!priority && (
                <>
                  <th className="numeric">Оценка роли</th>
                  <th>Кластер</th>
                  <th>Глубина</th>
                </>
              )}
              <th>Основание</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice((page - 1) * size, page * size).map((n) => (
              <tr
                key={n.gid}
                aria-selected={selected === n.gid}
                className={selected === n.gid ? "selected-row" : ""}
                onClick={() => onSelect(n.gid)}
              >
                <td className="numeric">{n.rank}</td>
                <td>
                  <Gid gid={n.gid} onSelect={onSelect} />
                </td>
                <td>
                  <RoleBadge role={n.role} />
                </td>
                <td className="numeric">
                  <span>{score(n.priority_score)}</span>
                  <span className="score-track">
                    <i style={{ width: `${n.priority_score * 100}%` }} />
                  </span>
                </td>
                {!priority && (
                  <>
                    <td className="numeric">{score(n.role_score)}</td>
                    <td>{n.cluster_id}</td>
                    <td>
                      {n.depth}
                      {n.is_seed ? " · S" : ""}
                    </td>
                  </>
                )}
                <td className="evidence-cell" title={n.evidence}>
                  <span>{n.evidence}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="empty">Нет узлов, соответствующих условиям.</p>
        )}
      </div>
      <Pagination
        page={page}
        size={size}
        total={rows.length}
        onPage={setPage}
        onSize={setSize}
      />
    </section>
  );
}
