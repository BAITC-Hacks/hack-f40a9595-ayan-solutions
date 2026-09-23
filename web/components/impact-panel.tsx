"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical, ArrowLeft, Play } from "lucide-react";
import { api, count, score } from "@/lib/utils";
import type { GraphData, Run } from "@/lib/types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import GraphCanvas, { defaultSettings } from "./graph-canvas";
import { ErrorState, Gid, Loading } from "./common";

interface Impact {
  run_id: string;
  removed_gid: string;
  sources: string[];
  n_sources: number;
  n_targets: number;
  before_pairs: number;
  after_pairs: number;
  lost_pairs: number;
  loss_ratio: number | null;
  affected_targets: number;
  lost_target_gids: string[];
  before_nodes: number;
  after_nodes: number;
  before_edges: number;
  after_edges: number;
  seconds: number;
  method: string;
  limitation: string;
}
export default function ImpactPanel({
  run,
  gid,
  onSelect,
}: {
  run: string;
  gid: string;
  onSelect: (gid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState(false);
  const [focused, setFocused] = useState(gid);
  const meta = useQuery({
    queryKey: ["run", run],
    queryFn: () => api<Run>(`/api/runs/${run}`),
    enabled: false,
  });
  const graph = useQuery({
    queryKey: ["graph", run],
    queryFn: () => api<GraphData>(`/api/runs/${run}/graph`),
    enabled: open,
  });
  const experiment = useMutation({
    mutationFn: () =>
      api<Impact>(`/api/runs/${run}/impact`, {
        method: "POST",
        body: JSON.stringify({ gid }),
      }),
  });
  const visible = useMemo(
    () =>
      new Set(
        graph.data?.nodes
          .filter((n) => !after || n.gid !== gid)
          .map((n) => n.gid) || [],
      ),
    [graph.data, after, gid],
  );
  const affected = useMemo(
    () => new Set(after ? experiment.data?.lost_target_gids || [] : []),
    [after, experiment.data],
  );
  if (!meta.data?.capabilities.impact) return null;
  const result = experiment.data;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          onClick={() => {
            setAfter(false);
            setFocused(gid);
          }}
        >
          <FlaskConical size={14} />
          Влияние на сеть
        </Button>
      </DialogTrigger>
      <DialogContent className="impact-dialog">
        <DialogTitle>Влияние на сеть</DialogTitle>
        <DialogDescription>
          Структурный эксперимент на копии наблюдаемого графа. Реальные счета не
          блокируются.
        </DialogDescription>
        <div className="impact-candidate">
          Исключаемый узел <Gid gid={gid} />
          <small>Запуск {run}</small>
        </div>
        <p className="muted">
          Источники: исходные узлы, кроме исключаемого. Цели: все оставшиеся
          узлы. До и после используются одинаковые наборы, пара узла с самим
          собой исключена.
        </p>
        {!result && (
          <Button
            variant="default"
            disabled={experiment.isPending}
            onClick={() => experiment.mutate()}
          >
            <Play size={14} />
            {experiment.isPending
              ? "Вычисление достижимости…"
              : "Запустить эксперимент"}
          </Button>
        )}
        {experiment.error && (
          <ErrorState
            error={experiment.error}
            retry={() => experiment.mutate()}
          />
        )}{" "}
        {result && (
          <>
            <div className="impact-metrics">
              <div>
                <small>Достижимые пары до</small>
                <strong>{count(result.before_pairs)}</strong>
              </div>
              <div>
                <small>После исключения</small>
                <strong>{count(result.after_pairs)}</strong>
              </div>
              <div>
                <small>Потеря пар</small>
                <strong>
                  {count(result.lost_pairs)} ·{" "}
                  {result.loss_ratio === null
                    ? "Не определено"
                    : `${score(result.loss_ratio * 100)}%`}
                </strong>
              </div>
              <div>
                <small>Затронутые цели</small>
                <strong>{count(result.affected_targets)}</strong>
              </div>
            </div>
            <div className="section-heading">
              <div className="tabs">
                <button aria-pressed={!after} onClick={() => setAfter(false)}>
                  До
                </button>
                <button aria-pressed={after} onClick={() => setAfter(true)}>
                  После
                </button>
              </div>
              <small>
                {count(after ? result.after_nodes : result.before_nodes)} узлов
                · {count(after ? result.after_edges : result.before_edges)}{" "}
                связей · {result.seconds} с
              </small>
            </div>
            <div className="impact-graph network-panel">
              {graph.isPending ? (
                <Loading />
              ) : graph.error ? (
                <ErrorState error={graph.error} />
              ) : (
                graph.data && (
                  <GraphCanvas
                    data={graph.data}
                    visible={visible}
                    selected={focused}
                    onSelect={(id) =>
                      setFocused(id.includes(":") ? id.split(":")[0] : id)
                    }
                    onNeighborhood={(id) => setFocused(id)}
                    colorBy="role"
                    settings={defaultSettings}
                    viewKey={`impact:${run}:${gid}`}
                    affected={affected}
                  />
                )
              )}
            </div>
            <p className="muted">
              {after
                ? "Оранжевая обводка: цели, потерявшие достижимость хотя бы от одного исходного узла."
                : "Полный наблюдаемый граф до исключения."}{" "}
              Координаты одинаковы до и после.
            </p>
            {focused && (
              <div>
                Выбранный узел{" "}
                <Gid
                  gid={focused}
                  onSelect={(id) => {
                    setOpen(false);
                    onSelect(id);
                  }}
                />
              </div>
            )}
            <details>
              <summary>Метод измерения</summary>
              <p>{result.method}</p>
              <p>
                {result.n_sources} источников, {result.n_targets} возможных
                целей.
              </p>
              <p>{result.limitation}</p>
            </details>
            <Button onClick={() => setOpen(false)}>
              <ArrowLeft size={14} />
              Вернуться к исходной сети
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
