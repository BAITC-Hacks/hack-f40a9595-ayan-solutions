"use client";
import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDownWideNarrow, Columns3 } from "lucide-react";
import type { NodeSummary } from "@/lib/types";
import { score, money } from "@/lib/utils";
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
  const pathname = usePathname();
  const params = useSearchParams();
  const updateTable = (patch: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([key, value]) => next.set(key, value));
    window.history.replaceState(null, "", pathname + "?" + next.toString());
  };
  const size = [25, 50, 100].includes(Number(params.get("table_size")))
    ? Number(params.get("table_size"))
    : 25;
  const sort = params.get("table_sort") || "priority";
  const local = params.get("table_local") === "1";
  const columns = params.get("columns") || "";
  const setPage = (value: number) => updateTable({ table_page: String(value) });
  const setSize = (value: number) =>
    updateTable({ table_size: String(value), table_page: "1" });
  const setSort = (value: string) =>
    updateTable({ table_sort: value, table_page: "1" });
  const setLocal = (value: boolean) =>
    updateTable({ table_local: value ? "1" : "0", table_page: "1" });
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
  const page = Math.max(
    1,
    Math.min(
      Number(params.get("table_page")) || 1,
      Math.ceil(rows.length / size) || 1,
    ),
  );
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
          {!priority && (
            <details className="column-picker">
              <summary>
                <Columns3 size={15} />
                Столбцы
              </summary>
              <div>
                {[
                  ["flow", "Входящие и исходящие"],
                  ["degree", "Число контрагентов"],
                ].map(([key, label]) => (
                  <label className="check-row" key={key}>
                    <input
                      type="checkbox"
                      checked={columns.includes(key)}
                      onChange={(e) =>
                        updateTable({
                          columns: e.target.checked
                            ? [columns, key].filter(Boolean).join(",")
                            : columns
                                .split(",")
                                .filter((k) => k !== key)
                                .join(","),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </details>
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
              {!priority && columns.includes("flow") && (
                <>
                  <th className="numeric">Входящие</th>
                  <th className="numeric">Исходящие</th>
                </>
              )}
              {!priority && columns.includes("degree") && (
                <>
                  <th className="numeric">Отправители</th>
                  <th className="numeric">Получатели</th>
                </>
              )}
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
                {!priority && columns.includes("flow") && (
                  <>
                    <td className="numeric">
                      {n.incoming_kzt ? money(n.incoming_kzt) : "—"}
                    </td>
                    <td className="numeric">
                      {n.outgoing_kzt ? money(n.outgoing_kzt) : "—"}
                    </td>
                  </>
                )}
                {!priority && columns.includes("degree") && (
                  <>
                    <td className="numeric">{n.unique_senders ?? "—"}</td>
                    <td className="numeric">{n.unique_receivers ?? "—"}</td>
                  </>
                )}
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
