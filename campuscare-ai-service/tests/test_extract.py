"""Detail extraction: same cases as the backend's JavaScript extractor (scripts/test-extract.mjs)."""
import json
from datetime import datetime
from pathlib import Path

import pytest

from campuscare_ai.extract import extract_details

CASES = json.loads((Path(__file__).parent / "extraction_cases.json").read_text(encoding="utf-8"))
NOW = datetime.fromisoformat(CASES["now"])


@pytest.mark.parametrize("case", CASES["cases"])
def test_extraction_case(case):
    r = extract_details(case["text"], NOW)
    assert r["location"] == case["location"]
    minutes = None
    if r["occurredAt"] is not None:
        at = datetime.fromisoformat(r["occurredAt"].replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
        minutes = round((NOW - at).total_seconds() / 60)
    assert minutes == case["minutesAgo"]
    for key in ("recurring", "peopleCount", "manyAffected"):
        if key in case:
            assert r[key] == case[key]


def test_missing_location_is_reported():
    assert extract_details("The wifi keeps disconnecting", NOW)["missing"] == ["location"]
