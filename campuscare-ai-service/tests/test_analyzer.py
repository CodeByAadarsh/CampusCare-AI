"""Model behaviour tests. Run with:  pytest -q   (trains the models first if models/ is empty)."""
import numpy as np
import pytest

from campuscare_ai.analyzer import load_analyzer
from campuscare_ai.config import load_settings
from campuscare_ai.labels import CATEGORIES


@pytest.fixture(scope="module")
def analyzer():
    return load_analyzer(load_settings())


def test_response_matches_backend_contract(analyzer):
    r = analyzer.analyze("The fan in room 210 is not working")
    assert {"category", "confidence", "severity", "urgency", "safetyImpact", "signals", "alternatives", "model"} <= set(r)
    assert r["category"] in CATEGORIES
    assert 0 <= r["confidence"] <= 1
    assert 1 <= r["severity"] <= 5 and 1 <= r["urgency"] <= 5
    assert 0 <= r["safetyImpact"] <= 1
    assert all(a["category"] in CATEGORIES for a in r["alternatives"])
    assert isinstance(r["signals"], list) and all(isinstance(s, str) for s in r["signals"])


@pytest.mark.parametrize("text, expected", [
    ("The ceiling fan in Block A room 104 is not working since two days", "electrical"),
    ("No water in the girls washroom since morning", "plumbing"),
    ("Garbage is piled up near the canteen and it stinks", "sanitation"),
    ("The CCTV camera at the main gate is broken", "security"),
    ("Mess food in the hostel is stale every night", "hostel"),
    ("The college bus on route 4 is late every day", "transport"),
    ("The projector in LT-1 shows a blue screen", "academic"),
    ("Wifi is not working in the library", "it"),
    ("Several chairs in the auditorium are broken", "infrastructure"),
])
def test_clear_reports_get_the_right_category(analyzer, text, expected):
    assert analyzer.analyze(text)["category"] == expected


def test_dangerous_report_is_escalated(analyzer):
    r = analyzer.analyze("The switchboard in ECE Lab 3 is sparking and wires are exposed")
    assert r["category"] == "electrical"
    assert r["severity"] == 5 and r["urgency"] >= 4 and r["safetyImpact"] >= 0.9
    assert "sparking" in r["signals"]


def test_minor_report_stays_low(analyzer):
    r = analyzer.analyze("The paint on the corridor walls is peeling")
    assert r["severity"] <= 2 and r["safetyImpact"] < 0.5


def test_hinglish_is_understood(analyzer):
    assert analyzer.analyze("hostel mein wifi nahi chal raha")["category"] == "it"
    assert analyzer.analyze("washroom bahut ganda hai")["category"] == "sanitation"


def test_student_category_does_not_hide_the_ai_suggestion(analyzer):
    r = analyzer.analyze("Wifi is not working in the library", category="academic")
    assert r["category"] == "it"
    assert r["details"]["studentCategory"] == "academic"


def test_embeddings_are_unit_vectors_and_capture_meaning(analyzer):
    a = np.array(analyzer.embed("Water is leaking from the ceiling in the corridor"))
    b = np.array(analyzer.embed("There is water dripping from the roof of the corridor"))
    c = np.array(analyzer.embed("The bus on route 4 was late today"))
    assert len(a) == analyzer.embedder.dim
    assert abs(np.linalg.norm(a) - 1) < 1e-3
    assert a @ b > a @ c
