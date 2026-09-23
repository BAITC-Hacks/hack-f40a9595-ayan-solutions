"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Database,
  FileText,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Network,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Users,
  Wallet,
  X,
  AlertTriangle,
  Layers,
} from "lucide-react";
import type { GraphData, Run, Cluster, RoleCode } from "@/lib/types";
import {
  api,
  ApiError,
  compactMoney,
  count,
  dateLabel,
  money,
  roles,
  clusterColor,
} from "@/lib/utils";
import {
  emptyFilters,
  filtersFrom,
  matches,
  visibleNodes,
  type Filters,
} from "@/lib/view-state";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";
import { ErrorState, Gid, Loading, RoleBadge } from "./common";
import GraphCanvas, {
  defaultSettings,
  type GraphSettings,
} from "./graph-canvas";
import NetworkFilters from "./filters";
import NodeTable from "./node-table";
import ObjectInspector from "./inspector";
import {
  ClusterPage,
  Clusters,
  MethodologyPage,
  NodePage,
  Overview,
  Reports,
  SourceData,
} from "./pages";

const nav = [
  ["overview", "Обзор", LayoutDashboard],
  ["network", "Сеть", Network],
  ["clusters", "Кластеры", Layers],
  ["nodes", "Узлы", Users],
  ["reports", "Отчёты", FileText],
] as const;

function GlobalSearch({
  graph,
  clusters,
  onSelect,
  onCluster,
}: {
  graph?: GraphData;
  clusters: Cluster[];
  onSelect: (gid: string) => void;
  onCluster: (cid: number) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [shortcut, setShortcut] = useState("Ctrl K");
  useEffect(
    () =>
      setShortcut(
        /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K",
      ),
    [],
  );
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    if (!q.trim() || !graph) return [];
    const query = q.trim();
    const nodes = graph.nodes
      .filter((n) => n.gid.includes(query))
      .sort(
        (a, b) =>
          Number(b.gid === query) - Number(a.gid === query) || a.rank - b.rank,
      )
      .slice(0, 7)
      .map((n) => ({ key: n.gid, type: "node" as const, node: n }));
    const cid = query.replace(/^кластер\s*/i, "");
    return [
      ...nodes,
      ...clusters
        .filter((c) => String(c.cluster_id) === cid)
        .slice(0, 3)
        .map((c) => ({
          key: String(c.cluster_id),
          type: "cluster" as const,
          cluster: c,
        })),
    ];
  }, [q, graph, clusters]);
  const choose = (i: number) => {
    const r = results[i];
    if (!r) return;
    if (r.type === "node") onSelect(r.node.gid);
    else onCluster(r.cluster.cluster_id);
    setOpen(false);
    setQ("");
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    const outside = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("mousedown", outside);
    };
  }, []);
  return (
    <div className="global-search" ref={wrap}>
      <Search size={17} />
      <label htmlFor="global-search" className="sr-only">
        Найти узел или кластер
      </label>
      <input
        id="global-search"
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={
          open && results[index] ? `result-${index}` : undefined
        }
        placeholder="Найти узел или кластер"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.stopPropagation();
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, results.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            choose(index);
          }
        }}
      />
      <kbd>{shortcut}</kbd>
      {open && q && (
        <div className="search-results" id="search-results" role="listbox">
          {results.length ? (
            results.map((r, i) => (
              <button
                id={`result-${i}`}
                role="option"
                aria-selected={i === index}
                className={i === index ? "active" : ""}
                key={`${r.type}:${r.key}`}
                onClick={() => choose(i)}
              >
                {r.type === "node" ? (
                  <>
                    <Network size={16} />
                    <span>
                      <code>{r.node.gid}</code>
                      <small>
                        {roles[r.node.role].label} · Кластер {r.node.cluster_id}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </>
                ) : (
                  <>
                    <Layers size={16} />
                    <span>
                      Кластер {r.cluster.cluster_id}
                      <small>{r.cluster.n_nodes} узлов</small>
                    </span>
                  </>
                )}
              </button>
            ))
          ) : (
            <p>Узел или кластер не найден в этом анализе.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Metrics({ run }: { run: Run }) {
  return (
    <div className="global-metrics">
      {[
        {
          label: "Узлы",
          value: count(run.rows.nodes),
          exact: count(run.rows.nodes),
          icon: Users,
        },
        {
          label: "Связи",
          value: count(run.rows.edges),
          exact: count(run.rows.edges),
          icon: GitBranch,
        },
        {
          label: "Сумма переводов в выборке",
          value: compactMoney(run.total_kzt),
          exact: `${money(run.total_kzt)}. Наблюдаемые переводы, не баланс и не объём преступных средств.`,
          icon: Wallet,
        },
        {
          label: "Компоненты связности",
          value: count(run.n_components),
          exact: "Слабосвязные компоненты, не аналитические кластеры",
          icon: Network,
        },
      ].map((m) => (
        <div key={m.label} className="metric" tabIndex={0} title={m.exact}>
          <m.icon size={20} />
          <div>
            <strong>{m.value}</strong>
            <span>{m.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Workspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const aiHealth = useQuery({
    queryKey: ["ai-health"],
    queryFn: async () => "",
    enabled: false,
    initialData: "",
  });
  const serialized = params.toString();
  const [settings, setSettings] = useState<GraphSettings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [pending, setPending] = useState("");
  const [runError, setRunError] = useState("");
  const [panelVersion, setPanelVersion] = useState(0);
  const route = pathname === "/" ? "network" : pathname.split("/")[1];
  const filters = useMemo(
    () => filtersFrom(new URLSearchParams(serialized)),
    [serialized],
  );
  const requestedRun = params.get("run") || "";
  const current = useQuery({
    queryKey: ["current"],
    queryFn: ({ signal }) => api<Run>("/api/runs/current", { signal }),
    staleTime: 0,
  });
  const rid = requestedRun || current.data?.run_id || "";
  const meta = useQuery({
    queryKey: ["run", rid],
    queryFn: ({ signal }) => api<Run>(`/api/runs/${rid}`, { signal }),
    enabled: Boolean(rid),
  });
  const run = meta.data?.status === "completed" ? meta.data : undefined;
  const graph = useQuery({
    queryKey: ["graph", rid],
    queryFn: ({ signal }) =>
      api<GraphData>(`/api/runs/${rid}/graph`, { signal }),
    enabled: run?.status === "completed",
  });
  const clusters = useQuery({
    queryKey: ["clusters", rid],
    queryFn: ({ signal }) =>
      api<{ items: Cluster[] }>(`/api/runs/${rid}/clusters`, { signal }),
    enabled: run?.status === "completed",
  });
  const poll = useQuery({
    queryKey: ["pending-run", pending],
    queryFn: () => api<Run>(`/api/runs/${pending}`),
    enabled: Boolean(pending),
    refetchInterval: (q) =>
      ["completed", "failed"].includes(q.state.data?.status || "")
        ? false
        : 1000,
  });
  const navigate = useCallback(
    (path: string) => {
      const url = new URL(path, "http://local");
      if (rid) url.searchParams.set("run", rid);
      router.push(url.pathname + "?" + url.searchParams.toString());
      setMobileNav(false);
    },
    [rid, router],
  );
  const update = useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(window.location.search);
      if (rid) next.set("run", rid);
      Object.entries(patch).forEach(([key, value]) => {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      });
      const target =
        (pathname === "/" ? "/network" : pathname) + "?" + next.toString();
      if (replace) window.history.replaceState(null, "", target);
      else window.history.pushState(null, "", target);
    },
    [serialized, rid, pathname, router],
  );
  const switchRun = useCallback(
    async (newRun: string) => {
      const [metadata] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ["run", newRun],
          queryFn: () => api<Run>(`/api/runs/${newRun}`),
        }),
        queryClient.fetchQuery({
          queryKey: ["graph", newRun],
          queryFn: () => api<GraphData>(`/api/runs/${newRun}/graph`),
        }),
      ]);
      if (metadata.status === "completed") {
        queryClient.removeQueries({ queryKey: ["dialogue"] });
        queryClient.removeQueries({ queryKey: ["ai-answer"] });
        await queryClient.invalidateQueries({ queryKey: ["current"] });
        router.push(`/network?run=${newRun}`);
        setPending("");
        setRunError("");
      }
    },
    [queryClient, router],
  );
  const recompute = useMutation({
    mutationFn: () => api<Run>("/api/runs", { method: "POST" }),
    onSuccess: (data) => {
      setPending(data.run_id!);
      setRunError("");
    },
    onError: (error) => setRunError(error.message),
  });
  useEffect(() => {
    if (poll.data?.status === "completed")
      void switchRun(poll.data.run_id!).catch((e) => setRunError(e.message));
    else if (poll.data?.status === "failed") {
      setRunError(poll.data.error || "Ошибка расчёта");
      setPending("");
    }
  }, [poll.data, switchRun]);
  useEffect(() => {
    if (pathname === "/")
      router.replace("/network" + (serialized ? "?" + serialized : ""));
  }, [pathname, router, serialized]);
  useEffect(() => {
    const mq = window.matchMedia("(max-width:1279px)");
    const set = () => setCompactViewport(mq.matches);
    set();
    mq.addEventListener("change", set);
    try {
      const saved = JSON.parse(
        localStorage.getItem("graph-money-view-v1") || "null",
      );
      if (saved) setSettings({ ...defaultSettings, ...saved });
    } catch {}
    return () => mq.removeEventListener("change", set);
  }, []);
  const changeSettings = (patch: Partial<GraphSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem("graph-money-view-v1", JSON.stringify(next));
    setSettingsNotice("Настройки вида сохранены");
  };
  const setFilters = (f: Filters) => {
    const next = new URLSearchParams(window.location.search);
    next.delete("table_page");
    ["role", "cluster", "depth", "priority", "seed", "boundary"].forEach((k) =>
      next.delete(k),
    );
    f.roles.forEach((r) => next.append("role", r));
    f.depth.forEach((d) => next.append("depth", String(d)));
    if (f.cluster) next.set("cluster", f.cluster);
    if (f.priority) next.set("priority", String(f.priority));
    if (f.seed) next.set("seed", "1");
    if (f.boundary) next.set("boundary", "1");
    if (rid) next.set("run", rid);
    window.history.pushState(null, "", pathname + "?" + next.toString());
  };
  const selected = params.get("edge") || params.get("gid") || "";
  const mode = params.get("mode") || "all";
  const anchor = params.get("anchor") || selected;
  const hops = Math.max(1, Math.min(3, Number(params.get("hops")) || 1));
  const direction = params.get("direction") || "all";
  const colorBy = params.get("color") || "role";
  const select = useCallback(
    (id: string) => {
      if (route === "network")
        update({
          gid: id.includes(":") ? null : id,
          edge: id.includes(":") ? id : null,
        });
      else navigate(`/network?${id.includes(":") ? "edge" : "gid"}=${id}`);
    },
    [route, update, navigate],
  );
  const neighborhood = useCallback(
    (gid: string) => {
      if (route === "network")
        update({
          gid,
          edge: null,
          anchor: gid,
          mode: "neighborhood",
          hops: "1",
        });
      else navigate(`/network?gid=${gid}&anchor=${gid}&mode=neighborhood`);
    },
    [route, update, navigate],
  );
  const visible = useMemo(
    () =>
      graph.data
        ? visibleNodes(graph.data, filters, mode, anchor, hops, direction)
        : new Set<string>(),
    [graph.data, filters, mode, anchor, hops, direction],
  );
  const edgeCount = useMemo(
    () =>
      graph.data?.edges.filter(
        (e) => visible.has(e.source) && visible.has(e.target),
      ).length || 0,
    [graph.data, visible],
  );
  const allNodes = useMemo(
    () => graph.data?.nodes.filter((n) => matches(n, filters)) || [],
    [graph.data, filters],
  );
  const top = useMemo(
    () =>
      graph.data?.nodes.filter(
        (n) =>
          n.rank <=
          (run?.artifacts.find((f) => f.name === "top_nodes.csv")?.rows || 0),
      ) || [],
    [graph.data, run],
  );
  const inspector = run && (
    <ObjectInspector
      run={rid}
      selected={selected}
      clusters={clusters.data?.items || []}
      onSelect={select}
      onNeighborhood={neighborhood}
      onNavigate={navigate}
      hidden={Boolean(
        selected && !visible.has(selected) && !selected.includes(":"),
      )}
      first={top.find((n) => n.rank === 1)?.gid}
    />
  );
  const activeFilters = route === "network" || route === "nodes";
  const sidebar = (
    <>
      <nav aria-label="Основная навигация">
        {nav
          .filter(
            ([key]) => (run?.capabilities || current.data?.capabilities)?.[key],
          )
          .map(([key, label, Icon]) => (
            <button
              key={key}
              title={label}
              className={route === key ? "nav-item active" : "nav-item"}
              aria-current={route === key ? "page" : undefined}
              onClick={() => {
                if (route !== key) navigate("/" + key);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {route === key && <ChevronRight size={14} />}
            </button>
          ))}
      </nav>
      {activeFilters && (
        <NetworkFilters
          value={filters}
          onChange={setFilters}
          clusters={clusters.data?.items || []}
        />
      )}
      <div className="sidebar-bottom">
        <button
          title="Данные и методика"
          className={route === "methodology" ? "nav-item active" : "nav-item"}
          onClick={() => navigate("/methodology")}
        >
          <Database size={18} />
          <span>Данные и методика</span>
        </button>
        <button
          title="Настройки вида"
          className="nav-item"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={18} />
          <span>Настройки вида</span>
        </button>
      </div>
    </>
  );
  const offline = [current.error, meta.error, graph.error, clusters.error].find(
    (error) =>
      error instanceof ApiError && (error.status === 0 || error.status >= 500),
  );
  return (
    <div
      className={`app-shell ${settings.compact ? "density-compact" : ""} ${settings.reducedMotion ? "reduced-motion" : ""}`}
    >
      <a href="#main-content" className="skip-link">
        К основному содержимому
      </a>
      <header className="topbar">
        <Button
          className="mobile-menu"
          size="icon"
          variant="ghost"
          aria-label="Открыть навигацию"
          onClick={() => setMobileNav(true)}
        >
          <Menu size={20} />
        </Button>
        <button className="brand" onClick={() => navigate("/network")}>
          <span>
            Graph <b>Money</b>
          </span>
          <small>Аналитика финансовой сети</small>
        </button>
        <GlobalSearch
          graph={graph.data}
          clusters={clusters.data?.items || []}
          onSelect={(gid) =>
            route === "network" ? select(gid) : navigate(`/network?gid=${gid}`)
          }
          onCluster={(cid) => navigate(`/clusters/${cid}`)}
        />
        <div
          className="run-status"
          title={
            run
              ? `${run.seconds} с · ${count(run.rows?.nodes || 0)} узлов · run ${rid}`
              : "Завершённого анализа нет"
          }
        >
          {pending ? (
            <LoaderCircle size={16} className="spin" />
          ) : offline ? (
            <AlertTriangle size={16} />
          ) : run ? (
            <CheckCircle2 size={16} />
          ) : (
            <CircleHelp size={16} />
          )}
          <div>
            <span>
              {pending
                ? "Выполняется"
                : offline
                  ? "Сервис недоступен"
                  : runError
                    ? "Ошибка расчёта"
                    : run
                      ? "Есть предупреждения"
                      : "Нет анализа"}
            </span>
            <small>
              {run
                ? `${dateLabel(run.period.from)} – ${dateLabel(run.period.to)}`
                : "Данные ещё не обработаны"}
            </small>
          </div>
        </div>
        <Button
          className="recompute"
          disabled={Boolean(pending) || recompute.isPending}
          title="Создать новый анализ"
          onClick={() => recompute.mutate()}
        >
          <RefreshCw size={15} className={pending ? "spin" : ""} />
          <span>Пересчитать</span>
        </Button>
      </header>
      <div className="workspace-shell">
        <aside className="sidebar">{sidebar}</aside>
        <main
          id="main-content"
          className={`route-content ${route === "network" ? "network-route" : ""}`}
        >
          <div className="global-notices">
            {offline && (
              <div className="notice error-notice">
                <ErrorState
                  error="Нет соединения с локальным сервисом. Показаны сохранённые результаты, если они доступны."
                  retry={() => {
                    void current.refetch();
                    void meta.refetch();
                    void graph.refetch();
                    void clusters.refetch();
                  }}
                />
              </div>
            )}
            {runError && (
              <ErrorState
                error={runError}
                retry={
                  pending
                    ? () =>
                        void switchRun(pending).catch((error) =>
                          setRunError(error.message),
                        )
                    : undefined
                }
              />
            )}{" "}
            {pending && (
              <div className="notice" role="status">
                <LoaderCircle size={15} className="spin" />
                {poll.data?.stage || "Запуск расчёта"} · {run ? "Показаны результаты предыдущего анализа." : "Создаётся первый анализ."}
              </div>
            )}
          </div>
          {!rid ? (
            current.isPending ? (
              <Loading />
            ) : current.error ? (
              <ErrorState
                error={current.error}
                retry={() => current.refetch()}
              />
            ) : route === "methodology" ? (
              <SourceData />
            ) : (
              <div className="initial-state">
                <Database size={40} />
                <h1>Данные ещё не обработаны</h1>
                <Button
                  variant="default"
                  disabled={Boolean(pending) || recompute.isPending}
                  onClick={() => recompute.mutate()}
                >
                  Запустить анализ <ArrowRight size={16} />
                </Button>
                <p>
                  Источник: локальная папка data/. Нужны nodes.parquet,
                  edges.parquet и transactions.parquet.
                </p>
                <button
                  className="link"
                  onClick={() => navigate("/methodology")}
                >
                  Данные и проверка файлов
                </button>
              </div>
            )
          ) : !run || !graph.data ? (
            meta.error || graph.error ? (
              <ErrorState error={(meta.error || graph.error)!} />
            ) : meta.data && meta.data.status !== "completed" ? (
              <ErrorState
                error={
                  meta.data.error ||
                  meta.data.stage ||
                  "Анализ ещё не завершён."
                }
              />
            ) : (
              <Loading />
            )
          ) : route === "network" ? (
            <div
              className="network-workspace"
              style={
                !compactViewport && settings.inspectorWidth
                  ? {
                      gridTemplateColumns: `minmax(0,1fr) ${settings.inspectorWidth}px`,
                    }
                  : undefined
              }
            >
              <div className="network-center">
                <Metrics run={run} />
                <div className="split-area" key={panelVersion}>
                  <ResizablePanelGroup direction="vertical">
                    <ResizablePanel defaultSize={66} minSize={48}>
                      <section className="network-panel">
                        <header className="network-heading">
                          <div>
                            <h1>Транзакционная сеть</h1>
                            <p>
                              Показано {count(visible.size)} из{" "}
                              {count(run.rows.nodes)} узлов; {count(edgeCount)}{" "}
                              из {count(run.rows.edges)} связей
                            </p>
                          </div>
                          <span className="live-label">
                            <i />
                            run {rid.slice(0, 8)}
                          </span>
                        </header>
                        <div className="graph-toolbar">
                          <select
                            aria-label="Режим графа"
                            value={mode}
                            onChange={(e) =>
                              update({
                                mode: e.target.value,
                                anchor:
                                  e.target.value === "neighborhood"
                                    ? selected
                                    : null,
                              })
                            }
                          >
                            <option value="all">Вся сеть</option>
                            <option value="cluster">Кластер</option>
                            <option
                              value="neighborhood"
                              disabled={!selected || selected.includes(":")}
                            >
                              Окружение
                            </option>
                          </select>
                          {mode === "cluster" && (
                            <select
                              aria-label="Кластер на графе"
                              value={filters.cluster}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  cluster: e.target.value,
                                })
                              }
                            >
                              <option value="">Все кластеры</option>
                              {clusters.data?.items.map((c) => (
                                <option key={c.cluster_id} value={c.cluster_id}>
                                  Кластер {c.cluster_id}
                                </option>
                              ))}
                            </select>
                          )}
                          {mode === "neighborhood" && (
                            <>
                              <select
                                aria-label="Переходы окружения"
                                value={hops}
                                onChange={(e) =>
                                  update({ hops: e.target.value })
                                }
                              >
                                {[1, 2, 3].map((n) => (
                                  <option key={n} value={n}>
                                    {n} {n === 1 ? "переход" : "перехода"}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label="Направление окружения"
                                value={direction}
                                onChange={(e) =>
                                  update({ direction: e.target.value })
                                }
                              >
                                <option value="all">Оба направления</option>
                                <option value="in">Входящие</option>
                                <option value="out">Исходящие</option>
                              </select>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Вернуться к исходным фильтрам"
                                aria-label="Вернуться к исходным фильтрам"
                                onClick={() =>
                                  update({ mode: "all", anchor: null })
                                }
                              >
                                <ArrowLeft size={16} />
                              </Button>
                            </>
                          )}
                          <select
                            aria-label="Цвет графа"
                            value={colorBy}
                            onChange={(e) => update({ color: e.target.value })}
                          >
                            <option value="role">Цвет по ролям</option>
                            <option value="cluster">Цвет по кластерам</option>
                          </select>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Настройки вида"
                            aria-label="Настройки графа"
                            onClick={() => setSettingsOpen(true)}
                          >
                            <SlidersHorizontal size={16} />
                          </Button>
                        </div>
                        {mode === "neighborhood" && (
                          <div className="mode-notice">
                            Временное окружение {anchor}. Фильтры сохранены для
                            возврата.
                          </div>
                        )}
                        <GraphCanvas
                          data={graph.data}
                          visible={visible}
                          selected={selected}
                          onSelect={select}
                          onNeighborhood={neighborhood}
                          colorBy={colorBy}
                          settings={settings}
                          viewKey={`${rid}:${mode}:${mode === "neighborhood" ? `${anchor}:${hops}:${direction}` : mode === "cluster" ? filters.cluster : ""}`}
                        />
                        {!visible.size && (
                          <Button
                            className="clear-empty"
                            onClick={() => setFilters({ ...emptyFilters })}
                          >
                            Сбросить фильтры
                          </Button>
                        )}
                        <div className="graph-legend">
                          {colorBy === "role"
                            ? (Object.keys(roles) as RoleCode[]).map((role) => (
                                <button
                                  key={role}
                                  title={role}
                                  aria-pressed={filters.roles.includes(role)}
                                  onClick={() =>
                                    setFilters({
                                      ...filters,
                                      roles: filters.roles.includes(role)
                                        ? filters.roles.filter(
                                            (r) => r !== role,
                                          )
                                        : [...filters.roles, role],
                                    })
                                  }
                                >
                                  <i
                                    style={{ background: roles[role].color }}
                                  />
                                  {roles[role].label}
                                </button>
                              ))
                            : clusters.data?.items
                                .filter((c) =>
                                  graph.data!.nodes.some(
                                    (n) =>
                                      n.cluster_id === c.cluster_id &&
                                      visible.has(n.gid),
                                  ),
                                )
                                .map((c) => (
                                  <button
                                    key={c.cluster_id}
                                    onClick={() =>
                                      setFilters({
                                        ...filters,
                                        cluster: String(c.cluster_id),
                                      })
                                    }
                                  >
                                    <i
                                      style={{
                                        background: clusterColor(c.cluster_id),
                                      }}
                                    />
                                    Кластер {c.cluster_id}
                                  </button>
                                ))}
                        </div>
                      </section>
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={34} minSize={20}>
                      <div className="priority-panel">
                        <NodeTable
                          nodes={top}
                          selected={selected}
                          onSelect={select}
                          run={rid}
                          priority
                          visible={visible}
                        />
                        <button
                          className="all-nodes-link"
                          onClick={() => navigate("/nodes")}
                        >
                          Все узлы <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </div>
              </div>
              {!compactViewport && (
                <aside
                  className="object-inspector"
                  aria-label="Инспектор объекта"
                >
                  {inspector}
                </aside>
              )}
            </div>
          ) : route === "overview" ? (
            <Overview run={run} graph={graph.data} navigate={navigate} />
          ) : route === "reports" ? (
            <Reports run={run} />
          ) : route === "clusters" ? (
            pathname.split("/")[2] ? (
              <ClusterPage
                key={pathname}
                run={run}
                id={Number(pathname.split("/")[2])}
                graph={graph.data}
                navigate={navigate}
                settings={settings}
              />
            ) : (
              <Clusters
                run={run}
                clusters={clusters.data?.items || []}
                navigate={navigate}
              />
            )
          ) : route === "nodes" ? (
            pathname.split("/")[2] ? (
              <NodePage
                key={pathname}
                run={run}
                gid={pathname.split("/")[2]}
                graph={graph.data}
                clusters={clusters.data?.items || []}
                navigate={navigate}
                settings={settings}
              />
            ) : (
              <div className="page-content nodes-page">
                <header className="page-heading">
                  <div>
                    <h1>Узлы сети</h1>
                    <p>Все роли являются гипотезами для проверки</p>
                  </div>
                </header>
                <div className="tabs">
                  <button
                    aria-pressed={params.get("tab") !== "priority"}
                    onClick={() => update({ tab: null })}
                  >
                    Все узлы
                  </button>
                  <button
                    aria-pressed={params.get("tab") === "priority"}
                    onClick={() => update({ tab: "priority" })}
                  >
                    Приоритетные
                  </button>
                </div>
                <NodeTable
                  nodes={
                    params.get("tab") === "priority"
                      ? allNodes.filter((n) => top.some((t) => t.gid === n.gid))
                      : allNodes
                  }
                  selected={selected}
                  onSelect={(gid) => navigate(`/nodes/${gid}`)}
                  run={rid}
                />
              </div>
            )
          ) : route === "methodology" ? (
            <MethodologyPage
              run={run}
              tab={params.get("tab") || "data"}
              setTab={(tab) => update({ tab })}
              onRun={(newRun) => void switchRun(newRun)}
            />
          ) : (
            <div className="initial-state">
              <h1>Страница не найдена</h1>
              <Button onClick={() => navigate("/network")}>Открыть сеть</Button>
            </div>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <span>
          <Database size={12} /> Обезличенный набор; анализ выполняется локально
        </span>
        <span>
          {aiHealth.data === "unavailable"
            ? "AI временно недоступен"
            : aiHealth.data === "connected"
              ? "AI подключён · внешний сервис"
              : run?.ai_status === "configured"
                ? "AI настроен · внешний сервис"
                : "AI не настроен"}
          <i />{" "}
          {run ? `${run.version} · ${run.seconds} с` : "Нет активного анализа"}
        </span>
      </footer>
      <div className="sr-only" aria-live="polite">
        {selected ? `Выбран объект ${selected}` : "Объект не выбран"}
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogTitle>Настройки вида</DialogTitle>
          <DialogDescription>Локальные параметры отображения</DialogDescription>
          <label className="settings-width">
            Ширина инспектора: {settings.inspectorWidth || 336} px
            <input
              aria-label="Ширина инспектора"
              type="range"
              min="336"
              max="480"
              step="8"
              value={settings.inspectorWidth || 336}
              onChange={(event) =>
                changeSettings({ inspectorWidth: Number(event.target.value) })
              }
            />
          </label>
          {[
            ["compact", "Компактная таблица"],
            ["labels", "Подписи узлов"],
            ["fixedSize", "Фиксированный размер узлов"],
            ["reducedMotion", "Уменьшить анимацию"],
          ].map(([key, label]) => (
            <label className="check-row settings-check" key={key}>
              <input
                type="checkbox"
                checked={Boolean(settings[key as keyof GraphSettings])}
                onChange={(e) => changeSettings({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <Button
            onClick={() => {
              setPanelVersion((v) => v + 1);
              changeSettings(defaultSettings);
            }}
          >
            Сбросить вид и размеры панелей
          </Button>
          <p role="status">{settingsNotice}</p>
        </DialogContent>
      </Dialog>
      <Dialog open={mobileNav} onOpenChange={setMobileNav}>
        <DialogContent className="navigation-drawer">
          <DialogTitle>Навигация</DialogTitle>
          <DialogDescription className="sr-only">
            Разделы и фильтры
          </DialogDescription>
          {sidebar}
        </DialogContent>
      </Dialog>
      {compactViewport && route === "network" && (
        <Dialog
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) select("");
          }}
        >
          <DialogContent className="inspector-sheet">
            <DialogTitle className="sr-only">Инспектор объекта</DialogTitle>
            <DialogDescription className="sr-only">
              Признаки, связи, переводы и AI
            </DialogDescription>
            {inspector}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default function AppShell() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: Infinity,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>
  );
}
