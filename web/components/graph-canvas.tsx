"use client";
import { memo, useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import { Minus, Plus, Scan, Maximize, Minimize } from "lucide-react";
import type { GraphData } from "@/lib/types";
import { roles, clusterColor, money } from "@/lib/utils";
import { Button } from "./ui/button";

const viewports = new Map<
  string,
  {
    zoom: number;
    pan: { x: number; y: number };
    positions: Record<string, { x: number; y: number }>;
  }
>();
export interface GraphSettings {
  labels: boolean;
  fixedSize: boolean;
  compact: boolean;
  reducedMotion: boolean;
}
export const defaultSettings: GraphSettings = {
  labels: false,
  fixedSize: false,
  compact: false,
  reducedMotion: false,
};
interface Props {
  data: GraphData;
  visible: Set<string>;
  selected: string;
  onSelect: (id: string) => void;
  onNeighborhood: (id: string) => void;
  colorBy: string;
  settings: GraphSettings;
  viewKey: string;
  external?: Set<string>;
}
function GraphCanvas({
  data,
  visible,
  selected,
  onSelect,
  onNeighborhood,
  colorBy,
  settings,
  viewKey,
  external,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const callbacks = useRef({ onSelect, onNeighborhood });
  callbacks.current = { onSelect, onNeighborhood };
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );
  const [fullscreen, setFullscreen] = useState(false);
  const colorsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!host.current) return;
    const css = getComputedStyle(host.current);
    colorsRef.current = Object.fromEntries(
      Object.keys(roles).map((role) => [
        role,
        css.getPropertyValue(`--gm-role-${role}`).trim(),
      ]),
    );
    const saved = viewports.get(data.run_id);
    const cy = cytoscape({
      container: host.current,
      layout: { name: "preset" },
      minZoom: 0.04,
      maxZoom: 5,
      elements: [
        ...data.nodes.map((n) => ({
          data: {
            id: n.gid,
            ...n,
            label: `${n.is_seed ? "S · " : ""}${n.gid}`,
            color: colorsRef.current[n.role],
          },
          position: saved?.positions[n.gid] || data.positions[n.gid],
        })),
        ...data.edges.map((e) => ({ data: e })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            width: "mapData(priority_score, 0, 1, 10, 28)",
            height: "mapData(priority_score, 0, 1, 10, 28)",
            label: "",
            "font-size": 11,
            color: "#edf5fc",
            "text-outline-color": "#08121b",
            "text-outline-width": 2,
            "text-valign": "bottom",
            "text-margin-y": 7,
            "border-width": 0,
          },
        },
        {
          selector: "edge",
          style: {
            width: "data(width)",
            "line-color": "#59748a",
            "target-arrow-color": "#7891a5",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            opacity: 0.42,
            "arrow-scale": 0.7,
          },
        },
        {
          selector: "node.chosen",
          style: {
            "border-width": 2,
            "border-color": "#edf5fc",
            label: "data(label)",
            "z-index": 100,
          },
        },
        {
          selector: "edge.chosen",
          style: {
            "line-color": "#7dd3fc",
            "target-arrow-color": "#7dd3fc",
            opacity: 1,
            "z-index": 99,
          },
        },
        {
          selector: ".context",
          style: {
            "border-width": 2,
            "border-style": "dashed",
            "border-color": "#edf5fc",
          },
        },
        { selector: ".labelled", style: { label: "data(label)" } },
        { selector: "node.priority-label", style: { label: "data(label)", "min-zoomed-font-size": 8 } },
      ],
    });
    cyRef.current = cy;
    cy.nodes().filter(n => n.data("rank") <= 5).addClass("priority-label");
    if (saved) {
      cy.zoom(saved.zoom);
      cy.pan(saved.pan);
    } else cy.fit(undefined, 40);
    cy.on("tap", "node", (e) => callbacks.current.onSelect(e.target.id()));
    cy.on("dbltap", "node", (e) =>
      callbacks.current.onNeighborhood(e.target.id()),
    );
    cy.on("tap", "edge", (e) => callbacks.current.onSelect(e.target.id()));
    cy.on("tap", (e) => {
      if (e.target === cy) callbacks.current.onSelect("");
    });
    cy.on("mouseover", "node,edge", (e) => {
      const el = e.target;
      const d = el.data();
      const p = e.renderedPosition;
      const text = el.isNode()
        ? `${d.gid} · ${roles[d.role as keyof typeof roles].label} · Кластер ${d.cluster_id}`
        : `${d.source} → ${d.target}\n${money(d.sum_kzt)} · ${d.n_tx} переводов`;
      setTip({
        x: Math.min(p.x + 12, (host.current?.clientWidth || 400) - 290),
        y: Math.max(10, p.y - 58),
        text,
      });
      if (el.isNode()) el.addClass("labelled");
    });
    cy.on("mouseout", "node,edge", (e) => {
      setTip(null);
      e.target.removeClass("labelled");
    });
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(host.current);
    return () => {
      const positions: Record<string, { x: number; y: number }> = {};
      cy.nodes().forEach((n) => {
        positions[n.id()] = { ...n.position() };
      });
      viewports.set(data.run_id, {
        zoom: cy.zoom(),
        pan: { ...cy.pan() },
        positions,
      });
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [data]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        n.style("display", visible.has(n.id()) ? "element" : "none");
        n.toggleClass("context", Boolean(external?.has(n.id())));
      });
      cy.edges().forEach((e) => {
        e.style(
          "display",
          visible.has(e.source().id()) && visible.has(e.target().id())
            ? "element"
            : "none",
        );
      });
    });
  }, [visible, external]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("chosen");
      if (selected) {
        const el = cy.getElementById(selected);
        el.addClass("chosen");
        if (el.isEdge()) el.connectedNodes().addClass("chosen");
        if (el.length && el.visible() && el.isNode()) {
          const p = el.renderedPosition();
          if (p.x < 30 || p.x > cy.width()-30 || p.y < 30 || p.y > cy.height()-30) cy.center(el);
        }
      }
    });
  }, [selected]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() =>
      cy.nodes().forEach((n) => {
        n.style(
          "background-color",
          colorBy === "cluster"
            ? clusterColor(n.data("cluster_id"))
            : colorsRef.current[n.data("role")],
        );
        n.style({
          width: settings.fixedSize ? 16 : 10 + 18 * n.data("priority_score"),
          height: settings.fixedSize ? 16 : 10 + 18 * n.data("priority_score"),
        });
        n.toggleClass("labelled", settings.labels);
      }),
    );
  }, [colorBy, settings]);
  useEffect(() => {
    const cy = cyRef.current;
    if (cy) cy.fit(cy.elements(":visible"), 40);
  }, [viewKey]);
  useEffect(() => {
    const listener = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);
  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (cy)
      cy.zoom({
        level: cy.zoom() * factor,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
  };
  return (
    <div className="canvas-wrap">
      <div
        ref={host}
        className="graph-canvas"
        role="img"
        aria-label={`Транзакционная сеть: ${visible.size} узлов. Доступная альтернатива: таблица узлов и вкладка связей.`}
      />
      {tip && (
        <div
          className="graph-tooltip"
          style={{ left: Math.max(8, tip.x), top: tip.y }}
        >
          {tip.text}
        </div>
      )}
      {!visible.size && (
        <div className="graph-empty">
          Нет узлов, соответствующих условиям. Сбросьте фильтры.
        </div>
      )}
      <div className="canvas-note">
        {colorBy === "role" ? "Цвет = роль" : "Цвет = кластер"} · Толщина =
        сумма переводов по связи
        <br />
        Сохранённая геометрия · S = исходный узел
      </div>
      <div className="viewport-controls">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Уменьшить граф"
          title="Уменьшить"
          onClick={() => zoom(0.8)}
        >
          <Minus size={17} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Вписать сеть в экран"
          title="Вписать видимую сеть"
          onClick={() =>
            cyRef.current?.fit(cyRef.current.elements(":visible"), 40)
          }
        >
          <Scan size={17} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Увеличить граф"
          title="Увеличить"
          onClick={() => zoom(1.25)}
        >
          <Plus size={17} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={
            fullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный граф"
          }
          title="Полноэкранный граф"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else
              void host.current?.closest(".network-panel")?.requestFullscreen();
          }}
        >
          {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
        </Button>
      </div>
    </div>
  );
}
export default memo(GraphCanvas);
