"use client";
import { RotateCcw, Filter } from "lucide-react";
import type { RoleCode, Cluster } from "@/lib/types";
import { roles } from "@/lib/utils";
import { emptyFilters, type Filters } from "@/lib/view-state";
import { Button } from "./ui/button";
export default function NetworkFilters({
  value,
  onChange,
  clusters,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  clusters: Cluster[];
}) {
  const active =
    value.roles.length +
    value.depth.length +
    Number(Boolean(value.cluster)) +
    Number(value.priority > 0) +
    Number(value.seed) +
    Number(value.boundary);
  const patch = (change: Partial<Filters>) => onChange({ ...value, ...change });
  const toggleRole = (role: RoleCode) =>
    patch({
      roles: value.roles.includes(role)
        ? value.roles.filter((r) => r !== role)
        : [...value.roles, role],
    });
  return (
    <section className="filters" aria-label="Фильтры сети">
      <div className="section-heading">
        <h2>
          <Filter size={15} /> Фильтры <small>{active || ""}</small>
        </h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Сбросить фильтры"
          title="Сбросить фильтры"
          onClick={() => onChange({ ...emptyFilters })}
        >
          <RotateCcw size={15} />
        </Button>
      </div>
      <fieldset>
        <legend>Роль</legend>
        {(Object.keys(roles) as RoleCode[]).map((role) => (
          <label className="check-row" key={role}>
            <input
              type="checkbox"
              checked={value.roles.includes(role)}
              onChange={() => toggleRole(role)}
            />
            <i style={{ background: roles[role].color }} />
            {roles[role].label}
          </label>
        ))}
      </fieldset>
      <label className="field-label">
        Кластер
        <input
          list="cluster-options"
          aria-label="Фильтр кластера"
          value={value.cluster}
          placeholder="Все кластеры"
          onChange={(e) => patch({ cluster: e.target.value })}
        />
        <datalist id="cluster-options">
          {clusters.map((c) => (
            <option key={c.cluster_id} value={c.cluster_id}>
              Кластер {c.cluster_id} · {c.n_nodes} узлов
            </option>
          ))}
        </datalist>
      </label>
      <fieldset>
        <legend>Глубина выгрузки</legend>
        <div className="depth-options">
          {[0, 1, 2, 3, 4].map((d) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={value.depth.includes(d)}
                onChange={() =>
                  patch({
                    depth: value.depth.includes(d)
                      ? value.depth.filter((x) => x !== d)
                      : [...value.depth, d],
                  })
                }
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field-label">
        Минимальный приоритет
        <div className="priority-input">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={value.priority}
            onChange={(e) => patch({ priority: Number(e.target.value) })}
          />
          <input
            aria-label="Точный минимальный приоритет"
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={value.priority}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n))
                patch({ priority: Math.max(0, Math.min(1, n)) });
            }}
          />
        </div>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={value.seed}
          onChange={(e) => patch({ seed: e.target.checked })}
        />
        Только исходные узлы
      </label>
      <label className="check-row" title="depth = 4; не признак виновности">
        <input
          type="checkbox"
          checked={value.boundary}
          onChange={(e) => patch({ boundary: e.target.checked })}
        />
        Граница выгрузки
      </label>
      <details className="legend">
        <summary>Легенда ролей</summary>
        {(Object.keys(roles) as RoleCode[]).map((r) => (
          <button
            key={r}
            title={r}
            aria-pressed={value.roles.includes(r)}
            onClick={() => toggleRole(r)}
          >
            <i style={{ background: roles[r].color }} />
            {roles[r].label}
          </button>
        ))}
      </details>
    </section>
  );
}
