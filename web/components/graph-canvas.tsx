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
const runPositions = new Map<
  string,
  Record<string, { x: number; y: number }>
>();
export interface GraphSettings {
  fixedSize: boolean;
  compact: boolean;
  reducedMotion: boolean;
  inspectorWidth?: number;
}
export const defaultSettings: GraphSettings = {
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
  affected?: Set<string>;
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
  affected,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const viewportKey = useRef(viewKey);
  const hydrated = useRef(false);
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
    const token = (name: string) => css.getPropertyValue(`--gm-${name}`).trim();
    colorsRef.current = Object.fromEntries(
      Object.keys(roles).map((role) => [
        role,
        css.getPropertyValue(`--gm-role-${role}`).trim(),
      ]),
    );
    const saved = viewports.get(viewKey);
    viewportKey.current = viewKey;
    hydrated.current = false;
    if (!runPositions.has(data.run_id))
      runPositions.set(data.run_id, { ...data.positions });
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
          position:
            runPositions.get(data.run_id)?.[n.gid] || data.positions[n.gid],
        })),
        ...data.edges.map((e) => ({ data: e })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            width: "mapData(priority_score, 0, 1, 8, 21)",
            height: "mapData(priority_score, 0, 1, 8, 21)",
            label: "",
            "font-size": 11,
            color: token("text"),
            "text-outline-color": token("bg"),
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
            "line-color": token("edge"),
            "target-arrow-color": token("edge-arrow"),
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
            "border-color": token("text"),
            label: "data(label)",
            "z-index": 100,
          },
        },
        {
          selector: "edge.chosen",
          style: {
            "line-color": token("focus"),
            "target-arrow-color": token("focus"),
            opacity: 1,
            "z-index": 99,
          },
        },
        {
          selector: ".context",
          style: {
            "border-width": 2,
            "border-style": "dashed",
            "border-color": token("text"),
          },
        },
        {
          selector: "node.affected",
          style: { "border-width": 3, "border-color": token("warning") },
        },
      ],
    });
    cyRef.current = cy;
    if (saved) {
      cy.zoom(saved.zoom);
      cy.pan(saved.pan);
    } else cy.fit(undefined, 40);
    cy.on("tap", "node", (e) => callbacks.current.onSelect(e.target.id()));
    cy.on("dbltap", "node", (e) =>
      callbacks.current.onNeighborhood(e.target.id()),
    );
    cy.on("tap", "edge", (e) => callbacks.current.onSelect(e.target.id()));
    cy.on("dragfree", "node", (e) => {
      runPositions.get(data.run_id)![e.target.id()] = {
        ...e.target.position(),
      };
    });
    cy.on("tap", (e) => {
      if (e.target === cy) callbacks.current.onSelect("");
    });
    cy.on("mouseover", "node,edge", (e) => {
      const el = e.target;
      const d = el.data();
      const p = e.renderedPosition;
      const text = el.isNode()
        ? `${roles[d.role as keyof typeof roles].label} · Кластер ${d.cluster_id}`
        : `${money(d.sum_kzt)} · ${d.n_tx} переводов`;
      setTip({
        x: Math.min(p.x + 12, (host.current?.clientWidth || 400) - 290),
        y: Math.max(10, p.y - 58),
        text,
      });
    });
    cy.on("mouseout", "node,edge", () => {
      setTip(null);
    });
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(host.current);
    return () => {
      const positions: Record<string, { x: number; y: number }> = {};
      cy.nodes().forEach((n) => {
        positions[n.id()] = { ...n.position() };
      });
      viewports.set(viewportKey.current, {
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
        n.toggleClass("affected", Boolean(affected?.has(n.id())));
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
  }, [visible, external, affected]);
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
          if (
            p.x < 30 ||
            p.x > cy.width() - 30 ||
            p.y < 30 ||
            p.y > cy.height() - 30
          )
            cy.center(el);
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
          width: settings.fixedSize ? 12 : 8 + 13 * n.data("priority_score"),
          height: settings.fixedSize ? 12 : 8 + 13 * n.data("priority_score"),
        });
      }),
    );
  }, [colorBy, settings]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!hydrated.current) {
      hydrated.current = true;
      if (!viewports.has(viewKey)) cy.fit(cy.elements(":visible"), 40);
      return;
    }
    if (viewportKey.current === viewKey) return;
    viewports.set(viewportKey.current, {
      zoom: cy.zoom(),
      pan: { ...cy.pan() },
      positions: runPositions.get(data.run_id) || data.positions,
    });
    viewportKey.current = viewKey;
    const saved = viewports.get(viewKey);
    if (saved) {
      cy.zoom(saved.zoom);
      cy.pan(saved.pan);
    } else cy.fit(cy.elements(":visible"), 40);
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
