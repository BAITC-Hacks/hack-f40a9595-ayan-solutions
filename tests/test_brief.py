import pytest

from ai_brief import local_brief, validate_brief


def test_local_brief_explains_boundary_and_requests_missing_data():
    context = {
        "evidence": "Граница четвёртого колена; нет наблюдаемых исходящих.",
        "truncated_by_depth": True,
        "is_seed": False,
        "related_gids": ["100000002984403100"],
    }
    brief = local_brief(context)
    assert "четвёртого колена" in brief["next_checks"][0]
    assert brief["related_gids"] == context["related_gids"]


def test_model_brief_rejects_unknown_gid_and_unsupported_number():
    context = {"related_gids": ["101"]}
    brief = {
        "summary": "Наблюдается связанная структура; требуется проверка.",
        "evidence_refs": ["in_degree"],
        "related_gids": ["102"],
        "limitations": ["Видна часть потоков."],
        "next_checks": ["Запросить дополнительные операции."],
    }
    with pytest.raises(ValueError, match="gid"):
        validate_brief(brief, context)
    brief["related_gids"] = ["101"]
    brief["summary"] = "Получил 999 переводов."
    with pytest.raises(ValueError, match="numbers"):
        validate_brief(brief, context)
