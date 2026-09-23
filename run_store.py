"""Immutable local runs and presentation DTOs. No web-specific changes to scoring."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import shutil
import threading
import time
import uuid

import networkx as nx
import pandas as pd

from analysis import Result, build_graph, load_data, run_pipeline, validate_outputs

ROOT = Path(__file__).resolve().parent
VERSION = "rules-v1-ui-v1"
LIMITS = [
    "Аналитическая гипотеза для проверки, не заключение о виновности.",
    "Наблюдаются исходящие переводы внутри банка; обход ограничен четырьмя коленами.",
    "В исходном наборе отсутствуют переводы ниже 5 000 KZT; полный баланс не наблюдается.",
    "Истинных размеченных ролей и персональных атрибутов нет; accuracy не измерена.",
    "Дата без времени не устанавливает последовательность движения средств.",
]
ROLE_NAMES = {"coordinator": "Координатор", "distributor": "Распределитель", "transit": "Транзит",
              "consolidator": "Консолидатор", "terminal": "Конечный получатель", "peripheral": "Периферия"}


def money(value):
    return format(Decimal(str(value)).quantize(Decimal("0.01")), "f")


def decimal_sum(values):
    return format(sum((Decimal(str(v)) for v in values), Decimal(0)).quantize(Decimal("0.01")), "f")


def role_rules(row, config):
    def rule(code, label, observed, operator, threshold):
        return {"code": code, "label": label, "observed": observed, "operator": operator,
                "threshold": threshold, "matched": True, "explanation": "Условие выбранного правила выполнено."}
    positive_in = rule("in_deg", "Отправители", int(row.in_deg), ">", 0)
    positive_out = rule("out_deg", "Получатели", int(row.out_deg), ">", 0)
    not_seed = rule("is_seed", "Исходный узел", str(bool(row.is_seed)).lower(), "=", "false")
    if row.role == "coordinator":
        return [rule("seed_reach", "Достижим от исходных узлов", int(row.seed_reach), ">=", config["coordinator_seed_reach"]),
                rule("p_betweenness", "Процентиль посредничества", float(row.p_betweenness), ">=", config["coordinator_betweenness_percentile"]),
                rule("other_clusters", "Соседние кластеры", int(row.other_clusters), ">=", config["coordinator_other_clusters"]),
                rule("both_directions", "Есть входящие и исходящие", "да", "=", "да")]
    if row.role == "distributor":
        return [rule("out_deg", "Уникальные получатели", int(row.out_deg), ">=", config["distributor_out_degree"])]
    if row.role == "consolidator":
        return [rule("in_deg", "Уникальные отправители", int(row.in_deg), ">=", config["consolidator_in_degree"]),
                rule("in_kzt", "Наблюдаемые входящие, KZT", money(row.in_kzt), ">", 0)]
    if row.role == "transit":
        return [not_seed, rule("both_directions", "Есть входящие и исходящие", "да", "=", "да"),
                rule("pass_through", "Исходящие / входящие", float(row.pass_through), "в диапазоне",
                     f"{config['transit_ratio_min']}–{config['transit_ratio_max']}"),
                rule("truncated_by_depth", "Обрезан границей", "нет", "=", "нет")]
    if row.role == "terminal":
        return [positive_in, rule("out_deg", "Исходящие связи", int(row.out_deg), "=", 0),
                rule("depth", "Глубина", int(row.depth), "<", 4), not_seed]
    return [rule("fallback", "Более ранние правила", "не выполнены", "=", "не выполнены")]


def positions_for(result):
    """Pack real communities without outlier components shrinking the entire viewport."""
    positions = {}
    groups = sorted(result.roles.groupby("cluster_id"), key=lambda item: (-len(item[1]), int(item[0])))
    radii = [max(18, math.sqrt(len(group)) * 14) for _, group in groups]
    shelf_width = max(max(radii) * 2 + 40, math.sqrt(sum((2*r+32)**2 for r in radii) * 2.1))
    x, y, shelf_height = 0, 0, 0
    for (cid, group), radius in zip(groups, radii):
        side = 2 * radius + 32
        if x + side > shelf_width:
            x, y, shelf_height = 0, y + shelf_height, 0
        sub = result.graph.subgraph(group.gid).to_undirected()
        local = nx.spring_layout(sub, seed=42, iterations=35, scale=radius, weight=None)
        for gid, xy in local.items():
            positions[str(gid)] = {"x": round(float(x + radius + xy[0]), 3),
                                   "y": round(float(y + radius + xy[1]), 3)}
        x += side
        shelf_height = max(shelf_height, side)
    return positions


class Snapshot:
    def __init__(self, result, meta, directory, positions=None):
        self.result, self.meta, self.directory = result, meta, directory
        joined = result.features.drop(columns=["priority_score"]).merge(result.roles, on=["gid", "cluster_id"])
        ordered = joined.sort_values(["priority_score", "gid"], ascending=[False, True])
        ranks = {int(gid): index for index, gid in enumerate(ordered.gid, 1)}
        self.nodes = {}
        self.details = {}
        for row in joined.itertuples(index=False):
            gid = str(row.gid)
            node = {"gid": gid, "role": row.role, "role_score": row.role_score, "cluster_id": int(row.cluster_id),
                    "priority_score": row.priority_score, "evidence": row.evidence, "depth": int(row.depth),
                    "is_seed": bool(row.is_seed), "rank": ranks[int(gid)]}
            self.nodes[gid] = node
            incoming = result.edges.loc[result.edges.dst.eq(int(gid)), "sum_kzt"]
            outgoing = result.edges.loc[result.edges.src.eq(int(gid)), "sum_kzt"]
            warnings = [{"code": "hypothesis", "message": LIMITS[0]}]
            if row.truncated_by_depth:
                warnings.append({"code": "boundary", "message": "Граница выгрузки: отсутствие исходящих не подтверждает конечного получателя."})
            if row.is_seed or row.out_kzt > row.in_kzt:
                warnings.append({"code": "incomplete", "message": "Полный баланс не наблюдается; входящие могут быть неполны."})
            if row.role == "peripheral":
                warnings.append({"code": "peripheral", "message": "Недостаточно признаков выбранных ролей; это не подтверждение отсутствия риска."})
            factors = [("Достижимость от seed", row.p_seed_reach, .30), ("Наблюдаемый вход", row.p_in_kzt, .25),
                       ("Число связей", max(row.p_in_deg, row.p_out_deg), .20),
                       ("Посредничество", row.p_betweenness, .15), ("PageRank", row.p_pagerank, .10)]
            self.details[gid] = {**node, "incoming_kzt": decimal_sum(incoming), "outgoing_kzt": decimal_sum(outgoing),
                "unique_senders": int(row.in_deg), "unique_receivers": int(row.out_deg),
                "in_tx": int(row.in_tx), "out_tx": int(row.out_tx),
                "observed_out_in_ratio": float(row.pass_through) if math.isfinite(row.pass_through) else None,
                "warnings": warnings, "role_rules": role_rules(row, result.manifest["config"]),
                "priority_explanation": "Взвешенная сумма процентилей среди положительных значений. Для изолированных узлов принудительно ноль. Это порядок проверки, не вероятность.",
                "priority_factors": [{"label": label, "normalized": float(value), "weight": weight,
                                      "contribution": float(value * weight)} for label, value, weight in factors]}
            node.update({key: self.details[gid][key] for key in ("incoming_kzt", "outgoing_kzt", "unique_senders", "unique_receivers")})
        max_amount = max(float(value) for value in result.edges.sum_kzt)
        self.edges = [{"id": f"{row.src}:{row.dst}", "source": str(row.src), "target": str(row.dst),
                       "sum_kzt": money(row.sum_kzt), "n_tx": int(row.n_tx),
                       "width": 1 + 3 * math.log1p(float(row.sum_kzt)) / math.log1p(max_amount)}
                      for row in result.edges.itertuples(index=False)]
        self.positions = positions if positions is not None else positions_for(result)
        self.clusters = []
        for row in result.clusters.itertuples(index=False):
            members = set(result.roles.loc[result.roles.cluster_id.eq(row.cluster_id), "gid"])
            inside = result.edges.src.isin(members) & result.edges.dst.isin(members)
            entering = ~result.edges.src.isin(members) & result.edges.dst.isin(members)
            leaving = result.edges.src.isin(members) & ~result.edges.dst.isin(members)
            self.clusters.append({"cluster_id": int(row.cluster_id), "n_nodes": int(row.n_nodes), "n_seed": int(row.n_seed),
                "sum_kzt_internal": money(row.sum_kzt_internal), "n_edges_internal": int(inside.sum()),
                "incoming_external_kzt": decimal_sum(result.edges.loc[entering, "sum_kzt"]),
                "outgoing_external_kzt": decimal_sum(result.edges.loc[leaving, "sum_kzt"]),
                "top_gids": json.loads(row.top_gids), "hypothesis": row.hypothesis, "method": "Правила"})

    def graph_dto(self):
        return {"run_id": self.meta["run_id"], "dataset_id": self.meta["dataset_id"], "nodes": list(self.nodes.values()),
                "edges": self.edges, "positions": self.positions}


class RunStore:
    def __init__(self, directory=None, data_dir=None):
        self.directory = Path(directory or ROOT / ".runs")
        self.data_dir = Path(data_dir or ROOT / "data")
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.runs, self.cache = {}, {}
        for path in self.directory.glob("*/run.json"):
            meta = json.loads(path.read_text())
            if meta["status"] in ("queued", "running"):
                meta.update(status="failed", error="Расчёт прерван при остановке сервиса.")
            self.runs[meta["run_id"]] = meta

    def current(self):
        complete = [run for run in self.runs.values() if run["status"] == "completed"]
        return max(complete, key=lambda run: run["started_at"]) if complete else None

    def create(self, background=True):
        # Validate before accepting the job; invalid source files never replace the current run.
        load_data(self.data_dir)
        with self.lock:
            if any(run["status"] in ("queued", "running") for run in self.runs.values()):
                raise RuntimeError("Другой расчёт уже выполняется.")
            rid = uuid.uuid4().hex[:16]
            meta = {"run_id": rid, "dataset_id": None, "status": "queued", "stage": "Подготовка снимка",
                    "started_at": datetime.now(timezone.utc).isoformat(), "version": VERSION, "seconds": None}
            folder = self.directory / rid
            (folder / "input").mkdir(parents=True)
            for name in ("nodes", "edges", "transactions"):
                shutil.copyfile(self.data_dir / f"{name}.parquet", folder / "input" / f"{name}.parquet")
            shutil.copyfile(ROOT / "config.json", folder / "config.json")
            self._save(meta)
            self.runs[rid] = meta
        if background:
            threading.Thread(target=self.execute, args=(rid,), daemon=True).start()
        else:
            self.execute(rid)
        return self.runs[rid]

    def _save(self, meta):
        path = self.directory / meta["run_id"] / "run.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        temp.replace(path)

    def execute(self, rid):
        start = time.monotonic()
        meta = self.runs[rid]
        folder = self.directory / rid
        try:
            meta.update(status="running", stage="Проверка, граф, признаки и экспорт")
            self._save(meta)
            result = run_pipeline(folder / "input", folder / "artifacts", folder / "config.json")
            result.features.to_parquet(folder / "features.parquet", index=False)
            meta["stage"] = "Валидация результатов и геометрия"
            self._save(meta)
            dataset_id = hashlib.sha256(json.dumps(result.manifest["sha256"], sort_keys=True).encode()).hexdigest()[:16]
            components = sorted((len(c) for c in nx.weakly_connected_components(result.graph)), reverse=True)
            meta.update(dataset_id=dataset_id, rows=result.manifest["rows"], sha256=result.manifest["sha256"],
                config=result.manifest["config"], n_seed=int(result.features.is_seed.sum()),
                n_boundary=int(result.features.depth.eq(4).sum()), n_isolates=len(list(nx.isolates(result.graph))),
                n_components=len(components), components=components, n_clusters=len(result.clusters),
                total_kzt=decimal_sum(result.transactions.sum_kzt),
                period={"from": str(result.transactions.date.min().date()), "to": str(result.transactions.date.max().date())},
                role_counts={role: int(result.roles.role.eq(role).sum()) for role in ROLE_NAMES},
                warnings=LIMITS, artifacts=[{"name": name, "rows": len(frame)} for name, frame in
                    [("nodes_roles.csv", result.roles), ("clusters.csv", result.clusters), ("top_nodes.csv", result.top)]],
                checks={"all_nodes": True, "required_fields": True, "finite_scores": True, "unique_top": True,
                        "valid_clusters": True, "valid_top_gids": all(set(json.loads(x)).issubset(set(result.roles.gid.astype(str))) for x in result.clusters.top_gids)})
            if not all(meta["checks"].values()):
                raise ValueError("Проверка артефактов не пройдена; новый анализ не опубликован.")
            snapshot = Snapshot(result, meta, folder)
            (folder / "positions.json").write_text(json.dumps(snapshot.positions))
            # Publish only once the whole snapshot and all validated artifacts exist.
            with self.lock:
                self.cache[rid] = snapshot
                meta.update(status="completed", stage="Готово", seconds=round(time.monotonic() - start, 3))
                self._save(meta)
        except Exception as exc:
            message = str(exc) if isinstance(exc, ValueError) else "Не удалось завершить локальный расчёт. Проверьте файлы и повторите."
            meta.update(status="failed", error=message, seconds=round(time.monotonic() - start, 3))
            self._save(meta)

    def snapshot(self, rid):
        with self.lock:
            if rid not in self.runs:
                raise KeyError("Анализ не найден.")
            if self.runs[rid]["status"] != "completed":
                raise RuntimeError("Результаты этого анализа ещё не готовы.")
            if rid not in self.cache:
                folder = self.directory / rid
                nodes, edges, tx = load_data(folder / "input")
                roles = pd.read_csv(folder / "artifacts/nodes_roles.csv", dtype={"gid": "int64"})
                clusters = pd.read_csv(folder / "artifacts/clusters.csv")
                top = pd.read_csv(folder / "artifacts/top_nodes.csv", dtype={"gid": "int64"})
                validate_outputs(nodes, roles, clusters, top)
                result = Result(build_graph(nodes, edges), pd.read_parquet(folder / "features.parquet"), roles, clusters, top,
                                edges, tx, json.loads((folder / "artifacts/manifest.json").read_text()))
                self.cache[rid] = Snapshot(result, self.runs[rid], folder, json.loads((folder / "positions.json").read_text()))
            return self.cache[rid]
