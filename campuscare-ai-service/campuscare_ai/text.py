"""Text clean-up shared by every model, so training and prediction see the same input."""
import re

_REPLACEMENTS = [
    (re.compile(r"[‘’‛`]"), "'"),
    (re.compile(r"[“”]"), '"'),
    (re.compile(r"\bwi[\s-]?fi\b"), "wifi"),
    (re.compile(r"\btube[\s-]?lights?\b"), "tubelight"),
    (re.compile(r"\be[\s-]?mail\b"), "email"),
    (re.compile(r"\bdon'?t\b"), "dont"),
    (re.compile(r"\bdoesn'?t\b"), "doesnt"),
    (re.compile(r"\bisn'?t\b"), "isnt"),
    (re.compile(r"\bcan'?t\b"), "cant"),
    (re.compile(r"\bwon'?t\b"), "wont"),
    (re.compile(r"\d+"), " 0 "),  # room and bus numbers carry no meaning for the labels
    (re.compile(r"\s+"), " "),
]


def normalize(text: str) -> str:
    t = str(text or "").lower()
    for pattern, repl in _REPLACEMENTS:
        t = pattern.sub(repl, t)
    return t.strip()
