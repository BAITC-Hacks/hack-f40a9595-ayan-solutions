"""Bounded analyst brief: local facts with optional structured model synthesis."""

from copy import deepcopy
import json
import os
import re

import requests

from temporal import daily_activity, temporal_summary


PROMPT = (
    "You assist a bank AML analyst. Use only the supplied anonymous transfer-graph facts. "
    "Write in Russian. This is a hypothesis for review, never an accusation. "
    "Do not invent identities, transfers, amounts, dates, or other facts. "
    "Keep numbers out of prose; the application displays verified numbers separately. "
    "Daily overlap does not prove the order or identity of transferred funds. "
    "Cite only evidence_refs and related_gids allowed by the response schema. "
    "Return at most five entries in each list. "
    "Suggest one or two concrete next checks for missing information."
)
FIELDS = ["summary", "evidence_refs", "related_gids", "limitations", "next_checks"]
EVIDENCE_REFS = [
    "in_degree", "out_degree", "in_kzt", "out_kzt", "seed_reach", "cluster_id",
    "depth", "role", "priority_score", "active_days", "same_day_both",
]
SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "evidence_refs": {"type": "array", "items": {"type": "string", "enum": EVIDENCE_REFS}, "maxItems": 5},
        "related_gids": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        "limitations": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        "next_checks": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
    },
    "required": FIELDS,
    "additionalProperties": False,
}


def node_context(result, gid):
    feature = result.features.set_index("gid").loc[gid]
    role = result.roles.set_index("gid").loc[gid]
    neighbors = sorted(set(result.graph.predecessors(gid)) | set(result.graph.successors(gid)))
    neighbor_roles = result.roles.set_index("gid").loc[neighbors] if neighbors else None
    related = []
    if neighbor_roles is not None:
        related = [str(value) for value in neighbor_roles.sort_values("priority_score", ascending=False).head(10).index]
    timing = temporal_summary(daily_activity(result.transactions, gid))
    return {
        "gid": str(gid), "role": role.role, "evidence": role.evidence,
        "priority_score": float(role.priority_score), "role_score": float(role.role_score),
        "in_degree": int(feature.in_deg), "out_degree": int(feature.out_deg),
        "in_kzt": float(feature.in_kzt), "out_kzt": float(feature.out_kzt),
        "seed_reach": int(feature.seed_reach), "cluster_id": int(feature.cluster_id),
        "depth": int(feature.depth), "is_seed": bool(feature.is_seed),
        "truncated_by_depth": bool(feature.truncated_by_depth),
        "related_gids": related,
        "active_days": timing["active_days"],
        "same_day_both": timing["same_day_both"],
    }


def local_brief(context):
    if context["truncated_by_depth"]:
        next_check = "Запросить исходящие переводы за пределами четвёртого колена."
        limitation = "Выходящие за границей обхода неизвестны."
    elif context["is_seed"]:
        next_check = "Запросить полный перечень входящих переводов клиента за период."
        limitation = "У seed входящие потоки в выгрузке неполны."
    else:
        next_check = "Проверить полную историю входящих и исходящих операций и контрагентов."
        limitation = "Видны только внутрибанковские переводы выше порога."
    overlap = context.get("same_day_both", 0)
    timing_note = f" В {overlap} дн. наблюдаются вход и выход; порядок операций неизвестен." if overlap else ""
    return {
        "summary": f"{context['evidence']}{timing_note} Роль является гипотезой для проверки.",
        "evidence_refs": ["in_degree", "out_degree", "in_kzt", "out_kzt"] + (["same_day_both"] if overlap else []),
        "related_gids": context["related_gids"][:5],
        "limitations": [limitation],
        "next_checks": [next_check],
    }


def validate_brief(brief, context):
    if not isinstance(brief, dict) or set(brief) != set(FIELDS):
        raise ValueError("Model answer has the wrong schema")
    if not isinstance(brief["summary"], str) or not brief["summary"].strip() or len(brief["summary"]) > 500:
        raise ValueError("Model summary is missing or too long")
    for key in FIELDS[1:]:
        if not isinstance(brief[key], list) or len(brief[key]) > 5 or not all(isinstance(item, str) and 0 < len(item) <= 180 for item in brief[key]):
            raise ValueError(f"Model {key} is invalid")
    if set(brief["related_gids"]) - set(context["related_gids"]):
        raise ValueError("Model cited a gid absent from context")
    if set(brief["evidence_refs"]) - set(EVIDENCE_REFS) or not brief["evidence_refs"]:
        raise ValueError("Model cited unsupported evidence")
    if re.search(r"\d", " ".join([brief["summary"], *brief["limitations"], *brief["next_checks"]])):
        raise ValueError("Model prose contains unverified numbers")
    return brief


def model_brief(context, api_key=None, model=None):
    api_key = api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    schema = deepcopy(SCHEMA)
    if context["related_gids"]:
        schema["properties"]["related_gids"]["items"]["enum"] = context["related_gids"]
    else:
        schema["properties"]["related_gids"]["maxItems"] = 0
    payload = {
        "model": model,
        "instructions": PROMPT,
        "input": json.dumps(context, ensure_ascii=False),
        "text": {"format": {"type": "json_schema", "name": "analyst_brief", "strict": True, "schema": schema}},
        "store": False,
    }
    return validate_brief(request_structured(payload, api_key), context)


def request_structured(payload, api_key):
    response = requests.post(
        "https://api.openai.com/v1/responses",
        json=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=20,
    )
    response.raise_for_status()
    body = response.json()
    if body.get("status") != "completed":
        raise ValueError("Model response was not completed")
    for item in body.get("output", []):
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if part.get("type") == "output_text":
                return json.loads(part["text"])
    raise ValueError("Model response contained no structured text")
