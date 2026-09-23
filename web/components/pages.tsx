"use client";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  FileSpreadsheet,
  FolderCheck,
  Play,
  ShieldAlert,
} from "lucide-react";
import type {
  Run,
  GraphData,
  Cluster,
  Methodology,
  Paged,
  RoleCode,
} from "@/lib/types";
import {
  api,
  count,
  money,
  dateLabel,
  roles,
  score,
  clusterColor,
} from "@/lib/utils";
import { Button } from "./ui/button";
import {
  ErrorState,
  ExportButton,
  Gid,
  Loading,
  Pagination,
  RoleBadge,
} from "./common";
import NodeTable from "./node-table";
import ObjectInspector from "./inspector";
import GraphCanvas, { type GraphSettings } from "./graph-canvas";
import { emptyFilters, visibleNodes } from "@/lib/view-state";

export function Overview({
  run,
  graph,
  navigate,
}: {
  run: Run;
  graph: GraphData;
  navigate: (path: string) => void;
}) {
  const [metric, setMetric] = useState("sum");
  const activity = useQuery({
    queryKey: ["activity", run.run_id],
    queryFn: () =>
      api<Paged<{ date: string; sum_kzt: string; n_tx: number }>>(
        `/api/runs/${run.run_id}/activity`,
      ),
  });
  const maximum = Math.max(
    ...(activity.data?.items.map((x) =>
      metric === "sum" ? Number(x.sum_kzt) : x.n_tx,
    ) || [1]),
  );
  return (
    <div className="page-content">
      <header className="page-heading">
        <div>
          <h1>Обзор анализа</h1>
          <p>
            {dateLabel(run.period.from)} – {dateLabel(run.period.to)} ·{" "}
            {run.seconds} с · {run.version}
          </p>
        </div>
        <Button variant="default" onClick={() => navigate("/network")}>
          Открыть сеть <ArrowUpRight size={15} />
        </Button>
      </header>
      <div className="overview-metrics">
        {[
          ["Узлы", count(run.rows.nodes)],
          ["Направленные связи", count(run.rows.edges)],
          ["Транзакции", count(run.rows.transactions)],
          ["Исходные узлы", count(run.n_seed)],
          ["Сумма переводов", money(run.total_kzt)],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="two-columns">
        <section>
          <h2>Распределение ролей</h2>
          {(Object.keys(roles) as RoleCode[]).map((role) => (
            <button
              className="role-bar"
              key={role}
              onClick={() => navigate(`/nodes?role=${role}`)}
            >
              <RoleBadge role={role} />
              <span className="bar">
                <i
                  style={{
                    width: `${(100 * run.role_counts[role]) / run.rows.nodes}%`,
                    background: roles[role].color,
                  }}
                />
              </span>
              <span>
                {count(run.role_counts[role])} ·{" "}
                {score((100 * run.role_counts[role]) / run.rows.nodes)}%
              </span>
            </button>
          ))}
        </section>
        <section>
          <h2>Компоненты и сообщества</h2>
          <div className="metric-grid">
            <div>
              <span>Слабосвязные компоненты</span>
              <strong>{count(run.n_components)}</strong>
            </div>
            <div>
              <span>Аналитические кластеры</span>
              <strong>{count(run.n_clusters)}</strong>
            </div>
          </div>
          <p>
            {count(run.rows.nodes - run.components[0])} узлов вне крупнейшей
            компоненты, включая {run.n_isolates} изолированных.
          </p>
          <div className="component-list">
            {run.components.slice(0, 5).map((n, i) => (
              <div key={i}>
                <span>Компонента {i + 1}</span>
                <b>{count(n)} узлов</b>
                <span>{score((n / run.rows.nodes) * 100)}%</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="page-section">
        <div className="section-heading">
          <h2>Активность за период</h2>
          <select
            aria-label="Метрика активности"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            <option value="sum">Сумма, KZT</option>
            <option value="count">Число переводов</option>
          </select>
        </div>
        {activity.isPending ? (
          <Loading />
        ) : activity.error ? (
          <ErrorState error={activity.error} />
        ) : (
          <div
            className="activity-chart"
            role="img"
            aria-label={
              metric === "sum"
                ? "Суммы наблюдаемых переводов по дням"
                : "Число переводов по дням"
            }
          >
            {activity.data.items.map((day) => (
              <div
                key={day.date}
                className="day-column"
                title={`${dateLabel(day.date)}: ${money(day.sum_kzt)}, ${day.n_tx} переводов`}
                tabIndex={0}
              >
                <div
                  className="day-bar"
                  style={{
                    height: `${Math.max(1, (100 * (metric === "sum" ? Number(day.sum_kzt) : day.n_tx)) / maximum)}%`,
                  }}
                />
                <small>{day.date.slice(8)}</small>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="page-section">
        <h2>С чего начать проверку</h2>
        <div className="starting-nodes">
          {[...graph.nodes]
            .sort((a, b) => a.rank - b.rank)
            .slice(0, 5)
            .map((n) => (
              <div key={n.gid}>
                <Gid
                  gid={n.gid}
                  onSelect={(gid) => navigate(`/network?gid=${gid}`)}
                />
                <RoleBadge role={n.role} />
                <b>{score(n.priority_score)}</b>
                <p>{n.evidence}</p>
              </div>
            ))}
        </div>
      </section>
      <section className="page-section limitations">
        <h2>Ограничения выборки</h2>
        <p>
          Граница выгрузки: {run.n_boundary} узлов. Нет разметки для оценки
          accuracy.
        </p>
        {run.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
      </section>
      <section className="page-section">
        <h2>Воспроизводимость</h2>
        <p>
          <CheckCircle2 size={16} />{" "}
          {Object.values(run.checks).every(Boolean)
            ? "Проверки backend пройдены"
            : "Есть ошибки проверки"}{" "}
          · три CSV созданы · запуск <code>{run.run_id}</code>
        </p>
        <Button onClick={() => navigate("/reports")}>
          Скачать результаты <ArrowUpRight size={15} />
        </Button>
      </section>
    </div>
  );
}

export function Reports({ run }: { run: Run }) {
  const descriptions: Record<string, string> = {
    "nodes_roles.csv": "Роли, оценки, кластеры и объяснения всех узлов",
    "clusters.csv": "Состав сообществ, внутренние суммы и гипотезы",
    "top_nodes.csv": "Глобальный рейтинг и основания приоритета",
  };
  const checks: Record<string, string> = {
    all_nodes: "Обработаны все исходные узлы",
    required_fields: "Заполнены обязательные поля",
    finite_scores: "Оценки конечны и находятся в [0, 1]",
    unique_top: "Топ содержит требуемое число уникальных GID",
    valid_clusters: "Все cluster_id существуют",
    valid_top_gids: "Ключевые GID кластеров валидны",
  };
  return (
    <div className="page-content">
      <header className="page-heading">
        <div>
          <h1>Результаты анализа</h1>
          <p>
            {dateLabel(run.period.from)} – {dateLabel(run.period.to)} ·{" "}
            {run.version}
          </p>
          <code>{run.run_id}</code>
        </div>
        <ExportButton
          run={run.run_id!}
          name="results.zip"
          label="Скачать пакет"
        />
      </header>
      <div className="artifact-grid">
        {run.artifacts.map((file) => (
          <article className="artifact" key={file.name}>
            <FileSpreadsheet size={24} />
            <h2>{file.name}</h2>
            <p>{descriptions[file.name]}</p>
            <p>{count(file.rows)} строк · готов</p>
            <ExportButton
              run={run.run_id!}
              name={file.name}
              label="Скачать CSV"
            />
          </article>
        ))}
      </div>
      <section className="page-section">
        <h2>Проверки артефактов</h2>
        {Object.entries(run.checks).map(([key, ok]) => (
          <p className="check-result" key={key}>
            {ok ? <CheckCircle2 size={17} /> : <ShieldAlert size={17} />}{" "}
            {checks[key] || key}
          </p>
        ))}
        <p className="muted">
          Полный набор конкретного завершённого запуска. Фильтры сети не
          изменяют эти файлы.
        </p>
        <ExportButton run={run.run_id!} name="manifest.json" />
      </section>
    </div>
  );
}

export function Clusters({
  run,
  clusters,
  navigate,
}: {
  run: Run;
  clusters: Cluster[];
  navigate: (path: string) => void;
}) {
  const [q, setQ] = useState("");
  const [seed, setSeed] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("size");
  const rows = clusters
    .filter((c) => String(c.cluster_id).includes(q) && (!seed || c.n_seed > 0))
    .sort((a, b) =>
      sort === "id"
        ? a.cluster_id - b.cluster_id
        : sort === "seed"
          ? b.n_seed - a.n_seed || a.cluster_id - b.cluster_id
          : b.n_nodes - a.n_nodes || a.cluster_id - b.cluster_id,
    );
  return (
    <div className="page-content">
      <header className="page-heading">
        <div>
          <h1>Кластеры сети</h1>
          <p>Группы узлов по структуре связей · Louvain · {run.run_id}</p>
        </div>
        <ExportButton run={run.run_id!} name="clusters.csv" />
      </header>
      <div className="list-toolbar">
        <label>
          Кластер
          <input
            aria-label="Поиск кластера"
            placeholder="Номер кластера"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={seed}
            onChange={(e) => {
              setSeed(e.target.checked);
              setPage(1);
            }}
          />
          С исходными узлами
        </label>
        <select
          aria-label="Сортировка кластеров"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="size">По числу узлов</option>
          <option value="id">По номеру</option>
          <option value="seed">По исходным узлам</option>
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Кластер</th>
              <th className="numeric">Узлы</th>
              <th className="numeric">Исходные</th>
              <th className="numeric">Внутренние переводы</th>
              <th>Ключевые GID</th>
              <th>Гипотеза по правилам</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice((page - 1) * 25, page * 25).map((c) => (
              <tr key={c.cluster_id}>
                <td>
                  <button
                    className="link"
                    onClick={() => navigate(`/clusters/${c.cluster_id}`)}
                  >
                    <i
                      className="dot"
                      style={{ background: clusterColor(c.cluster_id) }}
                    />
                    Кластер {c.cluster_id}
                  </button>
                </td>
                <td className="numeric">{c.n_nodes}</td>
                <td className="numeric">{c.n_seed}</td>
                <td className="numeric">{money(c.sum_kzt_internal)}</td>
                <td>
                  {c.top_gids.slice(0, 2).map((gid) => (
                    <Gid
                      key={gid}
                      gid={gid}
                      onSelect={(gid) => navigate(`/network?gid=${gid}`)}
                      copy={false}
                    />
                  ))}
                </td>
                <td className="evidence-cell" title={c.hypothesis}>
                  <span>{c.hypothesis}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="empty">Кластеры по этим условиям не найдены.</p>
        )}
      </div>
      <Pagination page={page} size={25} total={rows.length} onPage={setPage} />
    </div>
  );
}

export function ClusterPage({
  run,
  id,
  graph,
  navigate,
  settings,
}: {
  run: Run;
  id: number;
  graph: GraphData;
  navigate: (path: string) => void;
  settings: GraphSettings;
}) {
  const [external, setExternal] = useState(false);
  const [tab, setTab] = useState("members");
  const query = useQuery({
    queryKey: ["cluster", run.run_id, id],
    queryFn: () => api<Cluster>(`/api/runs/${run.run_id}/clusters/${id}`),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const c = query.data;
  const visible = visibleNodes(
    graph,
    { ...emptyFilters, cluster: String(id) },
    "cluster",
    "",
    1,
    "all",
    external,
  );
  const members = new Set(c.members!.map((n) => n.gid));
  const extras = new Set([...visible].filter((gid) => !members.has(gid)));
  return (
    <div className="page-content">
      <button className="link" onClick={() => navigate("/clusters")}>
        Кластеры / Кластер {id}
      </button>
      <header className="page-heading">
        <div>
          <h1>Кластер {id}</h1>
          <p>
            {dateLabel(run.period.from)} – {dateLabel(run.period.to)}
          </p>
        </div>
        <Button
          variant="default"
          onClick={() => navigate(`/network?mode=cluster&cluster=${id}`)}
        >
          Исследовать в сети <ArrowUpRight size={15} />
        </Button>
      </header>
      <div className="overview-metrics">
        {[
          ["Узлы", c.n_nodes],
          ["Исходные", c.n_seed],
          ["Внутренние связи", c.n_edges_internal],
          ["Внутренняя сумма", money(c.sum_kzt_internal)],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="cluster-summary">
        <div className="network-panel cluster-graph">
          <header>
            <label className="check-row">
              <input
                type="checkbox"
                checked={external}
                onChange={(e) => setExternal(e.target.checked)}
              />
              Показать внешние связи
            </label>
            <small>
              {c.n_nodes} участников · {extras.size} внешних узлов
            </small>
          </header>
          <GraphCanvas
            data={graph}
            visible={visible}
            selected=""
            onSelect={(gid) =>
              navigate(`/network?${gid.includes(":") ? "edge" : "gid"}=${gid}`)
            }
            onNeighborhood={(gid) =>
              navigate(`/network?gid=${gid}&anchor=${gid}&mode=neighborhood`)
            }
            colorBy="role"
            settings={settings}
            viewKey={`cluster:${id}:${external}`}
            external={extras}
          />
        </div>
        <section>
          <h2>Гипотеза по правилам</h2>
          <p>{c.hypothesis}</p>
          <p>Внешние входящие: {money(c.incoming_external_kzt)}</p>
          <p>Внешние исходящие: {money(c.outgoing_external_kzt)}</p>
          <p className="notice">
            Структурное сообщество не является доказанной преступной группой.
          </p>
        </section>
      </div>
      <div className="tabs">
        {[
          ["members", "Участники"],
          ["connections", "Межкластерные связи"],
          ["features", "Признаки"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "members" ? (
        <NodeTable
          nodes={c.members!}
          selected=""
          onSelect={(gid) => navigate(`/nodes/${gid}`)}
          run={run.run_id!}
        />
      ) : tab === "connections" ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Соседний кластер</th>
                <th>Направление</th>
                <th>Связи</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {c.cross_cluster?.map((x) => (
                <tr key={`${x.cluster_id}:${x.direction}`}>
                  <td>
                    <button
                      className="link"
                      onClick={() => navigate(`/clusters/${x.cluster_id}`)}
                    >
                      {x.cluster_id}
                    </button>
                  </td>
                  <td>{x.direction === "in" ? "Входящие" : "Исходящие"}</td>
                  <td>{x.n_edges}</td>
                  <td>{money(x.sum_kzt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className="page-section">
          {Object.entries(c.role_counts || {}).map(([role, n]) => (
            <p key={role}>
              <RoleBadge role={role as RoleCode} /> {n}
            </p>
          ))}
          <p>
            Доля исходных: {score((c.n_seed / c.n_nodes) * 100)}%. Использована
            взвешенная ненаправленная проекция транзакционных связей.
          </p>
        </section>
      )}
    </div>
  );
}

export function NodePage({
  run,
  gid,
  graph,
  clusters,
  navigate,
  settings,
}: {
  run: Run;
  gid: string;
  graph: GraphData;
  clusters: Cluster[];
  navigate: (path: string) => void;
  settings: GraphSettings;
}) {
  const visible = visibleNodes(
    graph,
    emptyFilters,
    "neighborhood",
    gid,
    1,
    "all",
  );
  return (
    <div className="page-content node-page">
      <header className="page-heading">
        <div>
          <button className="link" onClick={() => navigate("/nodes")}>
            Узлы / Карточка
          </button>
          <h1 className="gid">{gid}</h1>
        </div>
        <Button
          onClick={() =>
            navigate(`/network?gid=${gid}&anchor=${gid}&mode=neighborhood`)
          }
        >
          Показать на графе <ArrowUpRight size={15} />
        </Button>
      </header>
      <div className="node-page-grid">
        <section className="full-node-inspector">
          <ObjectInspector
            run={run.run_id!}
            selected={gid}
            clusters={clusters}
            onSelect={(id) => navigate(id ? `/nodes/${id}` : "/nodes")}
            onNeighborhood={(id) =>
              navigate(`/network?gid=${id}&anchor=${id}&mode=neighborhood`)
            }
            onNavigate={navigate}
            hidden={false}
          />
        </section>
        <section className="network-panel profile-graph">
          <header>
            <h2>Непосредственное окружение</h2>
          </header>
          <GraphCanvas
            data={graph}
            visible={visible}
            selected={gid}
            onSelect={(id) =>
              navigate(`/network?${id.includes(":") ? "edge" : "gid"}=${id}`)
            }
            onNeighborhood={(id) =>
              navigate(`/network?gid=${id}&anchor=${id}&mode=neighborhood`)
            }
            colorBy="role"
            settings={settings}
            viewKey={`profile:${gid}`}
          />
        </section>
      </div>
    </div>
  );
}

export function MethodologyPage({
  run,
  tab,
  setTab,
  onRun,
}: {
  run: Run;
  tab: string;
  setTab: (tab: string) => void;
  onRun: (run: string) => void;
}) {
  const method = useQuery({
    queryKey: ["methodology", run.run_id],
    queryFn: () => api<Methodology>(`/api/runs/${run.run_id}/methodology`),
  });
  const runs = useQuery({
    queryKey: ["runs", run.run_id],
    queryFn: () => api<{ items: Run[] }>("/api/runs"),
  });
  const validation = useMutation({
    mutationFn: () =>
      api<{ valid: boolean; rows: Run["rows"] }>("/api/data/validate", {
        method: "POST",
      }),
  });
  return (
    <div className="page-content">
      <header className="page-heading">
        <div>
          <h1>Данные и методика</h1>
          <p>
            {run.version} · dataset <code>{run.dataset_id}</code> · run{" "}
            <code>{run.run_id}</code>
          </p>
        </div>
      </header>
      <div className="tabs">
        {[
          ["data", "Данные"],
          ["rules", "Правила"],
          ["runs", "Запуски"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {method.isPending ? (
        <Loading />
      ) : method.error ? (
        <ErrorState error={method.error} />
      ) : tab === "rules" ? (
        <>
          <section className="page-section">
            <h2>Правила ролей</h2>
            <p>
              Первое сработавшее правило в следующем порядке. Значения ниже
              взяты из фактического запуска.
            </p>
            {method.data.role_order.map((role) => (
              <details className="method-rule" key={role}>
                <summary>
                  <RoleBadge role={role} /> <code>{role}</code>
                </summary>
                {method.data.examples[role]?.map((rule) => (
                  <p key={rule.code}>
                    {rule.label}: {rule.operator} {String(rule.threshold)}.
                    Пример наблюдения: {String(rule.observed)}.
                  </p>
                )) || (
                  <p>
                    В текущем запуске нет узлов этой роли. Пороги доступны в
                    конфигурации ниже.
                  </p>
                )}
              </details>
            ))}
          </section>
          {[
            ["Приоритет", method.data.priority],
            ["Нормализация", method.data.normalization],
            ["Оценка роли", method.data.role_score],
            ["Кластеризация и центральности", method.data.clustering],
            ["Геометрия и размеры", method.data.geometry],
            ["Петли", method.data.self_loops],
            ["Масштабирование", method.data.scaling],
          ].map(([label, text]) => (
            <section className="page-section" key={label}>
              <h2>{label}</h2>
              <p>{text}</p>
            </section>
          ))}
          <section className="page-section">
            <h2>Конфигурация запуска</h2>
            <pre>{JSON.stringify(method.data.config, null, 2)}</pre>
          </section>
        </>
      ) : tab === "runs" ? (
        <section className="page-section">
          {runs.isPending ? (
            <Loading />
          ) : runs.error ? (
            <ErrorState error={runs.error} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Run / dataset</th>
                    <th>Начало</th>
                    <th>Длительность</th>
                    <th>Состояние</th>
                    <th>Предупреждения</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.data.items.map((r) => (
                    <tr key={r.run_id}>
                      <td>
                        <code>{r.run_id}</code>
                        <br />
                        <code>{r.dataset_id || "Определяется"}</code>
                      </td>
                      <td>{new Date(r.started_at).toLocaleString("ru-RU")}</td>
                      <td>
                        {r.seconds === null ? "Выполняется" : `${r.seconds} с`}
                      </td>
                      <td>
                        {r.status === "completed"
                          ? "Готов"
                          : r.status === "failed"
                            ? r.error
                            : r.stage}
                      </td>
                      <td>{r.warnings?.length ?? "—"}</td>
                      <td>
                        {r.status === "completed" && (
                          <Button onClick={() => onRun(r.run_id!)}>
                            Открыть
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="page-section">
            <h2>Исходные файлы</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Файл</th>
                    <th>Строки</th>
                    <th>Обязательные поля</th>
                    <th>SHA-256</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(method.data.schemas).map(
                    ([name, columns]) => (
                      <tr key={name}>
                        <td>{name}.parquet</td>
                        <td>{run.rows[name as keyof Run["rows"]]}</td>
                        <td>
                          <code>{columns.join(", ")}</code>
                        </td>
                        <td>
                          <code className="hash">{run.sha256[name]}</code>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <p>
              Локальная папка <code>data/</code>. Замена файлов не изменяет уже
              завершённые запуски.
            </p>
            <Button
              disabled={validation.isPending}
              onClick={() => validation.mutate()}
            >
              <FolderCheck size={16} />
              Проверить файлы
            </Button>
            {validation.error && <ErrorState error={validation.error} />}{" "}
            {validation.data && (
              <p role="status">
                Схема, значения, ссылки и согласованность трёх файлов проверены.
              </p>
            )}
          </section>
          <section className="page-section limitations">
            <h2>Ограничения и доступ</h2>
            {method.data.limits.map((text) => (
              <p key={text}>{text}</p>
            ))}
            <p>
              Обезличенный набор; анализ выполняется локально. Аутентификация,
              роли доступа и аудит доступа в этой версии не реализованы.
            </p>
          </section>
          <section className="page-section">
            <h2>Валидация и преобразования</h2>
            <p>
              GID и счётчики приводятся к int64 после проверки целочисленности;
              даты разбираются явно. Пропуски обязательных полей, невалидные
              суммы, неизвестные узлы и несогласованность агрегатов отклоняются.
              Повторные строки переводов не удаляются. Изолированные узлы
              сохраняются.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
