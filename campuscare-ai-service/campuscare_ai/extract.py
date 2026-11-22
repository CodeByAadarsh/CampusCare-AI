"""
Pulls structured details out of a free-text complaint, so students only have to describe the problem.

  location      "Block B · Corridor · 2nd floor"   (None when no place is mentioned)
  occurredAt    ISO time the problem was noticed  ("since morning", "2 days ago", "since 10 am", ...)
  whenText      the words that gave the time
  recurring     True for "every day", "daily", "roz", ...
  peopleCount   an explicit number ("around 50 students")
  manyAffected  "many students", "whole class", "everyone", ...
  missing       details that could not be found, e.g. ["location"]

Rule-based (regular expressions + a campus place list): fast, explainable, no training data needed.
The backend has the same rules in JavaScript (src/ai/extract.js) as a fallback; both are checked
against tests/extraction_cases.json.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
       "eight": 8, "nine": 9, "ten": 10, "few": 3, "couple": 2, "several": 3}
UNIT_MIN = {"minute": 1, "min": 1, "hour": 60, "hr": 60, "day": 1440, "week": 10080, "month": 43200}
WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
ORD = {"ground": "Ground", "first": "1st", "1st": "1st", "second": "2nd", "2nd": "2nd", "third": "3rd", "3rd": "3rd",
       "fourth": "4th", "4th": "4th", "fifth": "5th", "5th": "5th", "top": "Top"}
ACRONYMS = {"ece", "cse", "eee", "ee", "me", "ice", "vlsi", "dsp", "rf", "dbms", "it"}
NUM_WORDS = r"a|an|one|two|three|four|five|six|seven|eight|nine|ten|few|couple of|several|\d+"
UNITS = r"minutes?|mins?|hours?|hrs?|days?|weeks?|months?"
DEPTS = ("digital electronics|microprocessor|communication|electronics|chemistry|robotics|physics|computer|drawing|"
         "analog|civil|mech|vlsi|dbms|ece|cse|eee|ice|dsp|rf|ee|me")


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _num(w: str) -> int:
    return int(w) if w.isdigit() else NUM.get(w.replace(" of", ""), 1)


def _unit(u: str) -> int:
    return UNIT_MIN.get(re.sub(r"s$", "", u), 1)


def _gender(w: str) -> str:
    if re.match(r"^(girl|ladies|women)", w):
        return "Girls"
    return "Staff" if w.startswith("staff") else "Boys"


def _dept(w: str) -> str:
    return w.upper() if w in ACRONYMS else " ".join(_cap(x) for x in w.split(" "))


# ---------------------------------------------------------------- location
PLACES = [
    (r"\bcentral library\b", "Central Library"),
    (r"\be-?library\b", "E-library"),
    (r"\breading hall\b", "Library reading hall"),
    (r"\blibrary\b", "Library"),
    (r"\bfood court\b", "Food court"),
    (r"\b(canteen|cafeteria)\b", "Canteen"),
    (r"\bmess\b", "Mess"),
    (r"\bauditorium\b", "Auditorium"),
    (r"\bseminar hall\b", "Seminar hall"),
    (r"\bconference room\b", "Conference room"),
    (r"\b(admin|administrative) (block|building)\b", "Admin block"),
    (r"\bstaff ?room\b", "Staff room"),
    (r"\bworkshop\b", "Workshop"),
    (r"\bserver room\b", "Server room"),
    (r"\bmain gate\b", "Main gate"),
    (r"\bback gate\b", "Back gate"),
    (r"\bgate (?:no\.? ?)?(\d{1,2})\b", lambda m: f"Gate {m.group(1)}"),
    (r"\b(bike|two[- ]wheeler|car|faculty) parking\b", lambda m: f"{_cap(m.group(1))} parking"),
    (r"\bparking\b", "Parking area"),
    (r"\bcycle stand\b", "Cycle stand"),
    (r"\bbasketball court\b", "Basketball court"),
    (r"\b(playground|sports ground|football ground|cricket ground)\b", lambda m: _cap(m.group(1))),
    (r"\bsports complex\b", "Sports complex"),
    (r"\bgym\b", "Gym"),
    (r"\bgarden\b", "Garden"),
    (r"\bboundary wall\b", "Boundary wall"),
    (r"\bbus stop\b", "Bus stop"),
]

SUB_PLACES = [
    (r"\b(boys?'?|girls?'?|gents|ladies|staff) (?:washroom|toilet|bathroom|restroom)s?\b", lambda m: f"{_gender(m.group(1))} washroom"),
    (r"\b(?:washroom|toilet|bathroom|restroom|urinal)s?\b", "Washroom"),
    (r"\bcorridor\b", "Corridor"),
    (r"\b(?:staircase|stairwell|stairs)\b", "Staircase"),
    (r"\b(?:lift|elevator)\b", "Lift"),
    (r"\blobby\b", "Lobby"),
    (r"\b(?:terrace|rooftop)\b", "Terrace"),
    (r"\bbalcony\b", "Balcony"),
]


def _first(rules, t):
    for pattern, out in rules:
        m = re.search(pattern, t)
        if m:
            return out(m) if callable(out) else out
    return None


def _building(t: str, original: str):
    m = re.search(r"\b(?:bus )?route (?:no\.? ?)?(\d{1,3})\b", t)
    if m:
        return {"label": f"Bus route {m.group(1)}"}
    m = re.search(r"\bbus (?:no\.?|number) ?(\d{1,3})\b", t)
    if m:
        return {"label": f"Bus no. {m.group(1)}"}
    m = re.search(r"\b([A-Z][a-z]+) route\b", original)
    if m and m.group(1) not in {"The", "Bus", "Route", "Our", "My", "This", "That", "Same"}:
        return {"label": f"{m.group(1)} route bus"}

    m = re.search(r"\b(boys?'?|girls?'?|men'?s|women'?s|ladies) ?hostel\b", t)
    if m:
        return {"label": f"{_gender(m.group(1))} Hostel"}
    if re.search(r"\bhostel\b", t):
        return {"label": "Hostel"}

    m = re.search(rf"\b({DEPTS}) (?:lab|laboratory)\b(?: (?:no\.? ?)?(\d{{1,2}})\b)?", t)
    if m:
        n = m.group(2)
        return {"label": f"{_dept(m.group(1))} Lab{' ' + n if n else ''}", "labNumber": n}
    m = re.search(r"\bIT (?:lab|Lab|department|dept)\b", original)
    if m:
        return {"label": "IT Lab" if re.search("lab", m.group(0), re.I) else "IT department"}
    m = re.search(rf"\b({DEPTS}) (?:department|dept)\b", t)
    if m:
        return {"label": f"{_dept(m.group(1))} department"}

    m = re.search(r"\b(?:block|building|bldg|tower) ?[-–]? ?([a-z]|\d{1,2})\b", t)
    if m:
        return {"label": f"Block {m.group(1).upper()}"}
    m = re.search(r"\b([A-Z])[- ]?[Bb]lock\b", original)
    if m:
        return {"label": f"Block {m.group(1)}"}
    m = re.search(r"\b([A-Z])[- ][Ww]ing\b", original)
    if m:
        return {"label": f"{m.group(1)} wing"}
    return None


def _room(t: str):
    m = re.search(r"\b(tutorial room|lecture hall|classroom|class|room|rm|lab|lt) ?(?:no\.?|number|#)? ?[-–]? ?(\d{1,4}[a-z]?)\b", t)
    if not m:
        return None
    kind, n = m.group(1), m.group(2).upper()
    if kind in ("lecture hall", "lt"):
        return {"label": f"LT-{n}", "kind": "lt", "n": n}
    if kind == "tutorial room":
        return {"label": f"Tutorial room {n}", "kind": "room", "n": n}
    if kind == "lab":
        return {"label": f"Lab {n}", "kind": "lab", "n": n}
    return {"label": f"Room {n}", "kind": "room", "n": n}


def extract_location(text: str):
    original = str(text or "")
    t = re.sub(r"\s+", " ", original.lower())
    parts = []
    b = _building(t, original)
    if b:
        parts.append(b["label"])
    place = _first(PLACES, t)
    if place and place not in parts:
        parts.append(place)
    sub = _first(SUB_PLACES, t)
    if sub:
        parts.append(sub)
    f = re.search(r"\b(ground|first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|top) floor\b", t)
    if f:
        parts.append(f"{ORD[f.group(1)]} floor")
    r = _room(t)
    if r and not (r["kind"] == "lab" and b and b.get("labNumber") == r["n"]):
        parts.append(r["label"])
    return " · ".join(parts) if parts else None


# ---------------------------------------------------------------- time noticed
def _at_clock(now: datetime, h: str, minute: str | None, ampm: str) -> datetime:
    hour = int(h) % 12 + (12 if ampm == "pm" else 0)
    d = now.replace(hour=hour, minute=int(minute or 0), second=0, microsecond=0)
    return d - timedelta(days=1) if d > now else d


def _part_of_day(now: datetime, hour: int) -> datetime:
    d = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    return now - timedelta(minutes=60) if d > now else d


def extract_when(text: str, now: datetime):
    t = re.sub(r"\s+", " ", str(text or "").lower())

    def ago(minutes):
        return now - timedelta(minutes=minutes)

    m = re.search(r"\b(just now|right now|abhi abhi|a few (?:minutes|mins) ago)\b", t)
    if m:
        return now, m.group(0)
    m = re.search(rf"\b({NUM_WORDS}) ?({UNITS}) (?:ago|back)\b", t)
    if m:
        return ago(_num(m.group(1)) * _unit(m.group(2))), m.group(0)
    m = re.search(rf"\b(?:since|for|from) (?:the )?(?:last |past )?({NUM_WORDS}) ?({UNITS})\b", t)
    if m:
        return ago(_num(m.group(1)) * _unit(m.group(2))), m.group(0)
    m = re.search(r"\b(?:since|from|at|around) (\d{1,2})(?::(\d{2}))? ?(am|pm)\b", t)
    if m:
        return _at_clock(now, m.group(1), m.group(2), m.group(3)), m.group(0)
    m = re.search(r"\b(?:since|this|from) morning\b|\bsubah se\b|\bmorning se\b", t)
    if m:
        return _part_of_day(now, 8), m.group(0)
    m = re.search(r"\b(?:since|this|from) afternoon\b", t)
    if m:
        return _part_of_day(now, 13), m.group(0)
    m = re.search(r"\b(?:since|this|from) evening\b|\bshaam se\b", t)
    if m:
        return _part_of_day(now, 18), m.group(0)
    m = re.search(r"\b(last night|yesterday night|kal raat)\b", t)
    if m:
        d = (now - timedelta(days=1)).replace(hour=21, minute=0, second=0, microsecond=0)
        return d, m.group(0)
    m = re.search(r"\b(?:since|from) yesterday\b|\byesterday\b|\bkal se\b", t)
    if m:
        return ago(24 * 60), m.group(0)
    m = re.search(rf"\b(?:since|last|from) ({'|'.join(WEEKDAYS)})\b", t)
    if m:
        js_day = (now.weekday() + 1) % 7  # Python Monday=0 -> JS Sunday=0
        diff = (js_day - WEEKDAYS.index(m.group(1)) + 7) % 7
        d = (now - timedelta(days=diff)).replace(hour=9, minute=0, second=0, microsecond=0)
        if d > now:
            d -= timedelta(days=7)
        return d, m.group(0)
    m = re.search(r"\b(?:since |for |from )?(?:last|past) week\b|\bek hafte se\b", t)
    if m:
        return ago(7 * 1440), m.group(0)
    m = re.search(r"\b(?:since the start of the semester|this semester|for months)\b", t)
    if m:
        return ago(30 * 1440), m.group(0)
    m = re.search(r"\b(today|aaj)\b", t)
    if m:
        return ago(120), m.group(0)
    return None


# ---------------------------------------------------------------- people affected
def extract_people(text: str):
    t = str(text or "").lower()
    m = re.search(r"\b(\d{1,4}) ?\+? ?(?:students|people|of us|persons|girls|boys|members|classmates)\b", t)
    count = min(500, int(m.group(1))) if m else None
    many = bool(count and count > 1) or bool(re.search(
        r"\b(many students|many people|lots of students|everyone|whole class|whole floor|whole hostel|whole batch|all of us|"
        r"all students|entire (?:class|floor|hostel|batch|block)|sab log|sabko)\b", t))
    return count, many


def _iso(d: datetime) -> str:
    if d.tzinfo is None:
        d = d.astimezone()  # naive = local time
    return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def extract_details(text: str, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    location = extract_location(text)
    when = extract_when(text, now)
    rec = re.search(r"\b(every ?day|daily|roz|every morning|every night|again and again)\b", str(text or "").lower())
    count, many = extract_people(text)
    return {
        "location": location,
        "occurredAt": _iso(when[0]) if when else None,
        "whenText": when[1] if when else (rec.group(0) if rec else None),
        "recurring": bool(rec),
        "peopleCount": count,
        "manyAffected": many,
        "missing": [] if location else ["location"],
    }
