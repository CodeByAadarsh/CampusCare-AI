import pandas as pd
import pytest

from campuscare_ai.rules import apply_rules
from campuscare_ai.text import normalize
from campuscare_ai.trainer import load_training_data


def test_rules_only_raise_scores():
    assert apply_rules("the fan is not working", 2, 2, 0.1) == (2, 2, 0.1, [])
    sev, urg, safety, hits = apply_rules("there is smoke coming from the panel", 2, 2, 0.1)
    assert (sev, urg, safety) == (5, 5, 1.0) and hits == ["fire or smoke"]
    sev, urg, safety, _ = apply_rules("someone is passing comments on girls", 5, 5, 1.0)
    assert (sev, urg, safety) == (5, 5, 1.0)


@pytest.mark.parametrize("text, signal", [
    ("sparks from the socket", "sparking"),
    ("switch board se chingari nikal rahi hai", "sparking"),
    ("naked wires hanging in the corridor", "exposed wiring"),
    ("I got a shock from the cooler", "electric shock"),
    ("seniors are ragging the freshers", "ragging or bullying"),
    ("the lift got stuck between floors", "people trapped"),
    ("plaster is falling from the ceiling", "structural collapse"),
    ("the driver was overspeeding", "unsafe driving"),
])
def test_danger_phrases_are_detected(text, signal):
    assert signal in apply_rules(text, 1, 1, 0.0)[3]


def test_no_false_alarm_on_ordinary_words():
    for text in ["we followed the instructions but the printer still jams", "the wifi is slow", "fire extinguisher sign is faded on the notice"]:
        hits = apply_rules(text, 1, 1, 0.0)[3]
        assert "harassment" not in hits


def test_normalize():
    assert normalize("Wi-Fi in Room 210 DOESN'T work") == "wifi in room 0 doesnt work"


def test_training_data_rejects_unknown_categories(tmp_path):
    path = tmp_path / "bad.csv"
    pd.DataFrame({"text": ["The canteen is closed today"], "category": ["food"]}).to_csv(path, index=False)
    with pytest.raises(ValueError, match="Unknown categories"):
        load_training_data([path])


def test_training_data_allows_missing_triage_labels(tmp_path):
    path = tmp_path / "real.csv"
    pd.DataFrame({"text": ["Wifi not working in block A", "Fan broken in room 3"], "category": ["it", "electrical"]}).to_csv(path, index=False)
    df = load_training_data([path])
    assert len(df) == 2 and df["severity"].isna().all()
