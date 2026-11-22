"""
Safety guardrails applied after the model.

A trained model can still under-rate a rare but dangerous report (a fire, an electric shock,
harassment). Missing one of those costs far more than over-rating a minor issue, so these rules
set a minimum severity, urgency and safety score whenever a clear danger phrase appears.
They only ever raise scores, never lower them, and each match is returned as a signal so
the admin can see why a report was escalated.
"""
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    signal: str
    pattern: re.Pattern
    severity: int
    urgency: int
    safety: float


def _rule(signal, regex, severity, urgency=4, safety=0.9):
    return Rule(signal, re.compile(regex, re.IGNORECASE), severity, urgency, safety)


RULES = [
    _rule("sparking", r"\bspark|chingari", 5),
    _rule("exposed wiring", r"(exposed|naked|live|open|loose)\s+(electric\s+)?wir|wires?\s+(are\s+)?(coming out|hanging|exposed|lying open)", 5),
    _rule("electric shock", r"electric(al)?\s+shock|\b(got|get|gives?|giving)\s+(a\s+)?(mild\s+)?(current|shock)\b|\bkarant\b", 5, 5, 1.0),
    _rule("fire or smoke", r"\bfire\b|\bsmoke\b|burning\s+(smell|wire|plastic)|smell\s+of\s+burning|\bblast\b", 5, 5, 1.0),
    _rule("gas leak", r"gas\s+leak", 5, 5, 1.0),
    _rule("harassment", r"harass|eve[\s-]?teas|passing\s+comments|molest|stalk|clicking\s+photos\s+of\s+girls|\b(was|were|being|got)\s+followed\b", 5, 5, 1.0),
    _rule("ragging or bullying", r"\bragg(ing|ed)\b|\bbull(y|ied|ying)\b|threaten", 5, 5, 1.0),
    _rule("violence or injury", r"\bfight(ing)?\b|\bassault|beat(en)?\s+up|bleeding|\binjur(ed|y|ies)\b|\bhurt\s+badly", 5, 5, 1.0),
    _rule("structural collapse", r"(ceiling|plaster|roof|false ceiling).{0,40}(fell|falling|fall|gir)|about\s+to\s+(fall|collapse)|could\s+fall\s+anytime|collaps", 5, 4, 0.9),
    _rule("people trapped", r"stuck\s+between\s+floors|trapped|atak\s+gay", 4, 5, 0.9),
    _rule("unsafe driving", r"rash(ly)?\s+driv|rash\s+drive|overspeed|(phone|smok\w*).{0,30}while\s+driving|talking\s+on\s+the\s+phone.{0,30}overtak|tez\s+chala", 4, 4, 0.9),
]


def apply_rules(text: str, severity: int, urgency: int, safety: float):
    """Returns (severity, urgency, safety, matched signals) with minimums from matching rules applied."""
    matched = []
    for rule in RULES:
        if rule.pattern.search(text):
            matched.append(rule.signal)
            severity = max(severity, rule.severity)
            urgency = max(urgency, rule.urgency)
            safety = max(safety, rule.safety)
    return severity, urgency, safety, matched
