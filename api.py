"""Loopback-only API for the Graph Money workspace."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
import io
import json
import os
import threading
from typing import Literal
import uuid
import zipfile

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from ai_chat import FACT_LABELS, chat_context, model_answer, validate_question
from ai_safety import AI_POLICY_VERSION, UnsafeAIInput
from analysis import ROLES, load_data
from run_store import LIMITS, ROLE_NAMES, ROOT, RunStore, decimal_sum, money

load_dotenv(ROOT / ".env")
store = RunStore(os.getenv("GRAPH_RUNS_DIR"), os.getenv("GRAPH_DATA_DIR"))
app = FastAPI(title="Graph Money", docs_url="/api/docs")
CAPABILITIES = {name: True for name in ("network", "overview", "nodes", "clusters", "reports", "methodology", "ai", "settings")}
CAPABILITIES.update(impact=False, paths=False, saved_reports=False, minimap=False, upload=False)
ai_cache = {}
ai_lock = threading.Lock()


def fail(status, code, message, retryable=False):
    raise HTTPException(status, {"code": code, "message": message, "retryable": retryable, "request_id": uuid.uuid4().hex[:12]})


@app.middleware("http")
async def local_mutations(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        allowed = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (3000, 3001, 8000)}
        if os.getenv("GRAPH_UI_ORIGIN"):
            allowed.add(os.environ["GRAPH_UI_ORIGIN"])
        if origin and origin not in allowed:
            return JSONResponse({"code": "origin", "message": "Запрос разрешён только из локального приложения.",
                                 "retryable": False, "request_id": uuid.uuid4().hex[:12]}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail), "retryable": False, "request_id": uuid.uuid4().hex[:12]}
    return JSONResponse(detail, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    fields = ", ".join(".".join(str(part) for part in error["loc"]) for error in exc.errors())
    return JSONResponse({"code": "invalid_request", "message": f"Проверьте параметры: {fields}", "retryable": False,
                         "request_id": uuid.uuid4().hex[:12]}, status_code=422)


@app.exception_handler(Exception)
async def internal_error(request, exc):
    return JSONResponse({"code": "internal_error", "message": "Локальный сервис не смог выполнить запрос.",
                         "retryable": True, "request_id": uuid.uuid4().hex[:12]}, status_code=500)


def snapshot(rid):
    try:
        return store.snapshot(rid)
    except KeyError:
        fail(404, "run_not_found", "Анализ не найден.")
    except RuntimeError as exc:
        fail(409, "run_not_ready", str(exc), True)


def node(snap, gid):
    if gid not in snap.nodes:
        fail(404, "node_not_found", "Узел не найден в этом анализе.")
    return snap.nodes[gid]


def metadata(meta):
    return {**(meta or {"run_id": None, "status": "empty"}), "capabilities": CAPABILITIES,
            "ai_status": "configured" if os.getenv("OPENAI_API_KEY") else "not_configured"}


@app.get("/api/runs/current")
def current():
    return metadata(store.current())


@app.get("/api/runs")
def runs():
    return {"items": sorted(store.runs.values(), key=lambda x: x["started_at"], reverse=True)}


@app.post("/api/runs", status_code=202)
def create_run():
    try:
        return store.create()
    except ValueError as exc:
        fail(422, "invalid_dataset", str(exc))
    except RuntimeError as exc:
        fail(409, "run_busy", str(exc), True)


@app.post("/api/data/validate")
def validate_data():
    try:
        nodes, edges, tx = load_data(store.data_dir)
        return {"valid": True, "rows": {"nodes": len(nodes), "edges": len(edges), "transactions": len(tx)}}
    except ValueError as exc:
        fail(422, "invalid_dataset", str(exc))


@app.get("/api/runs/{rid}")
def run_status(rid: str):
    if rid not in store.runs:
        fail(404, "run_not_found", "Анализ не найден.")
    return metadata(store.runs[rid])


@app.get("/api/runs/{rid}/graph")
def graph(rid: str):
    return snapshot(rid).graph_dto()


@app.get("/api/runs/{rid}/nodes")
def nodes(rid: str, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
          sort: Literal["priority", "gid", "role", "role_score", "incoming", "outgoing"] = "priority",
          role: list[str] = Query(default=[]), cluster: int | None = None,
          depth: list[int] = Query(default=[]), is_seed: bool | None = None,
          boundary: bool = False, gid: str = Query("", max_length=30),
          priority: float = Query(0, ge=0, le=1), top: bool = False):
    snap = snapshot(rid)
    if set(role) - ROLES or set(depth) - set(range(5)):
        fail(422, "invalid_filter", "Неизвестная роль или глубина.")
    items = [n for n in snap.nodes.values() if (not role or n["role"] in role)
             and (cluster is None or n["cluster_id"] == cluster) and (not depth or n["depth"] in depth)
             and (is_seed is None or n["is_seed"] == is_seed) and (not boundary or n["depth"] == 4)
             and gid in n["gid"] and n["priority_score"] >= priority
             and (not top or n["rank"] <= len(snap.result.top))]
    key = {"priority": lambda n: (-n["priority_score"], int(n["gid"])), "gid": lambda n: int(n["gid"]),
           "role": lambda n: (n["role"], int(n["gid"])), "role_score": lambda n: (-n["role_score"], int(n["gid"])),
           "incoming": lambda n: (-Decimal(snap.details[n["gid"]]["incoming_kzt"]), int(n["gid"])),
           "outgoing": lambda n: (-Decimal(snap.details[n["gid"]]["outgoing_kzt"]), int(n["gid"]))}[sort]
    items.sort(key=key)
    return {"run_id": rid, "items": items[(page-1)*page_size:page*page_size], "total": len(items), "page": page}


@app.get("/api/runs/{rid}/nodes/{gid}")
def node_detail(rid: str, gid: str):
    snap = snapshot(rid)
    node(snap, gid)
    return {"run_id": rid, **snap.details[gid]}


@app.get("/api/runs/{rid}/nodes/{gid}/connections")
def connections(rid: str, gid: str, direction: Literal["all", "in", "out"] = "all", q: str = Query("", max_length=30),
                page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)):
    snap = snapshot(rid)
    node(snap, gid)
    rows = []
    for edge in snap.edges:
        incoming, outgoing = edge["target"] == gid, edge["source"] == gid
        if (direction == "in" and not incoming) or (direction == "out" and not outgoing) or not (incoming or outgoing):
            continue
        other = edge["source"] if incoming else edge["target"]
        if q not in other:
            continue
        rows.append({**edge, "gid": other, "role": snap.nodes[other]["role"],
                     "direction": "self" if incoming and outgoing else "in" if incoming else "out"})
    rows.sort(key=lambda x: (-Decimal(x["sum_kzt"]), int(x["gid"])))
    return {"run_id": rid, "items": rows[(page-1)*page_size:page*page_size], "total": len(rows)}


def tx_rows(snap, gid=None, source=None, target=None, direction="all", sort="date", page=1, page_size=25):
    tx = snap.result.transactions.copy()
    tx["reference"] = [f"row-{i+1}" for i in range(len(tx))]
    if gid is not None:
        incoming, outgoing = tx.dst.eq(int(gid)), tx.src.eq(int(gid))
        tx = tx.loc[incoming if direction == "in" else outgoing if direction == "out" else incoming | outgoing]
    if source is not None:
        tx = tx.loc[tx.src.eq(int(source)) & tx.dst.eq(int(target))]
    tx = tx.sort_values(["sum_kzt", "date"] if sort == "amount" else ["date", "src", "dst"], ascending=sort != "amount", kind="stable")
    rows = [{"source": str(row.src), "target": str(row.dst), "date": row.date.isoformat() if row.date.time().isoformat() != "00:00:00" else str(row.date.date()),
             "sum_kzt": money(row.sum_kzt), "reference": row.reference,
             "direction": "self" if str(row.src) == str(row.dst) == gid else "in" if str(row.dst) == gid else "out"}
            for row in tx.iloc[(page-1)*page_size:page*page_size].itertuples(index=False)]
    return {"run_id": snap.meta["run_id"], "items": rows, "total": len(tx)}


@app.get("/api/runs/{rid}/nodes/{gid}/transactions")
def transactions(rid: str, gid: str, direction: Literal["all", "in", "out"] = "all", sort: Literal["date", "amount"] = "date",
                 page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)):
    snap = snapshot(rid)
    node(snap, gid)
    return tx_rows(snap, gid=gid, direction=direction, sort=sort, page=page, page_size=page_size)


@app.get("/api/runs/{rid}/edges/{source}/{target}")
def edge_detail(rid: str, source: str, target: str, page: int = Query(1, ge=1)):
    snap = snapshot(rid)
    edge = next((edge for edge in snap.edges if edge["source"] == source and edge["target"] == target), None)
    if edge is None:
        fail(404, "edge_not_found", "Направленная связь не найдена.")
    return {"run_id": rid, **edge, "source_role": snap.nodes[source]["role"], "target_role": snap.nodes[target]["role"],
            "transactions": tx_rows(snap, source=source, target=target, page=page)}


@app.get("/api/runs/{rid}/clusters")
def clusters(rid: str):
    return {"run_id": rid, "items": sorted(snapshot(rid).clusters, key=lambda x: (-x["n_nodes"], x["cluster_id"]))}


@app.get("/api/runs/{rid}/clusters/{cid}")
def cluster_detail(rid: str, cid: int):
    snap = snapshot(rid)
    item = next((cluster for cluster in snap.clusters if cluster["cluster_id"] == cid), None)
    if item is None:
        fail(404, "cluster_not_found", "Кластер не найден.")
    cross = defaultdict(lambda: {"n_edges": 0, "sum": Decimal(0)})
    for edge in snap.edges:
        a, b = snap.nodes[edge["source"]]["cluster_id"], snap.nodes[edge["target"]]["cluster_id"]
        if a != b and cid in (a, b):
            key = (b if a == cid else a, "out" if a == cid else "in")
            cross[key]["n_edges"] += 1
            cross[key]["sum"] += Decimal(edge["sum_kzt"])
    members = [n for n in snap.nodes.values() if n["cluster_id"] == cid]
    return {"run_id": rid, **item, "members": members,
            "role_counts": {role: sum(n["role"] == role for n in members) for role in ROLE_NAMES},
            "cross_cluster": [{"cluster_id": key[0], "direction": key[1], "n_edges": v["n_edges"], "sum_kzt": money(v["sum"])} for key, v in cross.items()]}


@app.get("/api/runs/{rid}/activity")
def activity(rid: str):
    snap = snapshot(rid)
    return {"run_id": rid, "items": [{"date": str(date.date()), "sum_kzt": decimal_sum(group.sum_kzt), "n_tx": len(group)}
             for date, group in snap.result.transactions.groupby(snap.result.transactions.date.dt.normalize())]}


@app.get("/api/runs/{rid}/methodology")
def methodology(rid: str):
    snap = snapshot(rid)
    examples = {}
    for detail in snap.details.values():
        examples.setdefault(detail["role"], detail["role_rules"])
    return {"run_id": rid, "version": snap.meta["version"], "config": snap.meta["config"], "limits": LIMITS,
            "role_order": list(ROLE_NAMES), "examples": examples,
            "priority": "0.30 × p_seed_reach + 0.25 × p_in_kzt + 0.20 × max(p_in_deg, p_out_deg) + 0.15 × p_betweenness + 0.10 × p_pagerank. Изоляты = 0.",
            "normalization": "Процентили среди положительных значений; нулевые признаки получают ноль. Роли: первое сработавшее правило.",
            "role_score": "Эвристика 0.5 + 0.4 × сила профильного признака; периферия 0.2, изоляты 0. На обрезанной границе максимум 0.6. Не калиброванная вероятность.",
            "clustering": "Louvain на ненаправленной проекции, веса суммируются для встречных рёбер. Seed из конфигурации. Betweenness направленный, без денежных весов; PageRank взвешен суммами.",
            "geometry": "Стабильная упаковка сообществ по размеру, spring-геометрия внутри каждого сообщества. Межкластерные расстояния не означают силу связи. Размер = 10 + 18 × приоритет; толщина = 1 + 3 × log1p(сумма)/max(log1p(сумма)). Геометрия не является признаком роли.",
            "self_loops": "Петля считается одной направленной связью; входит один раз во входящие и один раз в исходящие метрики. В общей сумме перевод учитывается один раз.",
            "scaling": "Для миллиона узлов: колонночный ETL, разбиение по компонентам, приближённые centrality и серверные выборки подграфов. Текущая реализация хранит граф в памяти и не проверена на таком объёме.",
            "schemas": {"nodes": ["gid", "depth", "is_seed"], "edges": ["src", "dst", "sum_kzt", "n_tx", "depth"], "transactions": ["src", "dst", "date", "sum_kzt"]}}


@app.get("/api/runs/{rid}/artifacts/{name}")
def artifact(rid: str, name: str):
    snap = snapshot(rid)
    allowed = {"nodes_roles.csv", "clusters.csv", "top_nodes.csv", "manifest.json"}
    if name == "results.zip":
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(allowed):
                archive.write(snap.directory / "artifacts" / file, file)
            archive.writestr("methodology.json", json.dumps(methodology(rid), ensure_ascii=False, indent=2))
            archive.writestr("run.json", json.dumps(snap.meta, ensure_ascii=False, indent=2))
        return Response(buffer.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="graph-money-{rid}.zip"'})
    if name not in allowed:
        fail(404, "artifact_not_found", "Артефакт не найден.")
    return FileResponse(snap.directory / "artifacts" / name, filename=name)


class AIRequest(BaseModel):
    gid: str = Field(min_length=1, max_length=30, pattern=r"^\d+$")
    action: Literal["explain", "challenge", "next", "question"] = "explain"
    question: str = Field(default="", max_length=1000)


@app.post("/api/runs/{rid}/ai")
def ai(rid: str, body: AIRequest):
    snap = snapshot(rid)
    detail = node(snap, body.gid)
    questions = {"explain": "Объясни назначенную роль по фактически сработавшему правилу.",
                 "challenge": "Какие ограничения и контраргументы не позволяют считать эту роль установленным фактом?",
                 "next": "Что следует проверить дальше и какие данные для этого отсутствуют?"}
    question = body.question if body.action == "question" else questions[body.action]
    try:
        validate_question(question)
    except (ValueError, UnsafeAIInput):
        fail(422, "unsafe_question", "Вопрос отклонён защитой. Задайте вопрос о признаках и связях выбранного узла.")
    key = (rid, body.gid, AI_POLICY_VERSION, body.action, question)
    if key in ai_cache:
        return {**ai_cache[key], "cached": True}
    context = chat_context(snap.result, int(body.gid))
    base = {"run_id": rid, "gid": body.gid, "evidence_version": AI_POLICY_VERSION, "cached": False,
            "facts": [{"key": "evidence", "label": "Основание правила", "value": detail["evidence"]}],
            "counterarguments": [warning["message"] for warning in snap.details[body.gid]["warnings"]],
            "next_check": "Проверить полноту входящих и исходящих, даты и контрагентов; запросить данные за границей выгрузки.",
            "references": [body.gid], "preparation": ["Рассчитанные признаки выбранного узла", "Непосредственные соседи: до десяти по приоритету"]}
    if not os.getenv("OPENAI_API_KEY"):
        return {**base, "mode": "rules", "interpretation": detail["evidence"]}
    if not ai_lock.acquire(blocking=False):
        fail(429, "ai_busy", "Другой AI-запрос выполняется. Повторите после его завершения.", True)
    try:
        answer = model_answer(context, question)
        response = {**base, "mode": "llm", "interpretation": answer["answer"],
                    "counterarguments": answer["limitations"] + base["counterarguments"],
                    "references": list(dict.fromkeys([body.gid, *answer["related_gids"]])),
                    "facts": [{"key": key, "label": FACT_LABELS.get(key, key), "value": context["facts"][key]} for key in answer["evidence_refs"]]}
        ai_cache[key] = response
        return response
    except Exception:
        fail(503, "ai_unavailable", "AI временно недоступен или ответ не прошёл проверку. Объяснение правил остаётся доступным.", True)
    finally:
        ai_lock.release()
