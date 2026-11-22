"""
Puts the pieces together: category model, severity/urgency/safety heads, safety rules, explanations
and the embedder. `load_analyzer()` is what the API calls at startup.
"""
from __future__ import annotations

import json
import logging
import warnings

import numpy as np
import sklearn

from .classical import ClassicalModel
from .config import Settings
from .embeddings import LSAEmbedder
from .extract import extract_details
from .labels import CATEGORIES
from .rules import apply_rules
from .trainer import CLASSICAL_FILE, LSA_FILE, META_FILE, train_models
from .transformer import BertCategoryClassifier, bert_available

log = logging.getLogger("campuscare_ai")


def _clamp_level(x: float) -> int:
    return int(min(5, max(1, round(float(x)))))


class Analyzer:
    def __init__(self, classical: ClassicalModel, embedder, bert: BertCategoryClassifier | None = None):
        self.classical = classical
        self.embedder = embedder
        self.bert = bert

    @property
    def classifier_name(self) -> str:
        return f"{self.bert.name}+{self.classical.meta.get('model', 'tfidf')}" if self.bert else self.classical.meta.get("model", "tfidf")

    def analyze(self, text: str, category: str | None = None) -> dict:
        """Response for POST /analyze. `category` (the student's choice) is accepted but the model's own
        prediction is returned, so the backend can show the AI suggestion next to the student's choice."""
        X = self.classical.transform([text])
        probs = self.classical.predict_proba([text], X=X)

        if self.bert:
            labels, cat_p = self.bert.labels, self.bert.predict_proba([text])[0]
        else:
            labels, cat_p = self.classical.classes("category"), probs["category"][0]
        order = np.argsort(cat_p)[::-1]
        top = labels[order[0]]

        severity_raw = float(self.classical.expected_level(probs["severity"], "severity")[0])
        urgency_raw = float(self.classical.expected_level(probs["urgency"], "urgency")[0])
        safety_model = float(self.classical.safety_probability(probs["safety"])[0])
        severity, urgency, safety, rule_hits = apply_rules(text, _clamp_level(severity_raw), _clamp_level(urgency_raw), safety_model)

        signals = list(rule_hits)
        signals += self.classical.explain(X, "category", top, top=4)
        if safety >= 0.5:
            signals += self.classical.explain(X, "safety", 1, top=3)
        signals = list(dict.fromkeys(signals))[:8]

        return {
            "category": top,
            "confidence": round(float(cat_p[order[0]]), 3),
            "alternatives": [
                {"category": labels[i], "confidence": round(float(cat_p[i]), 3)} for i in order[1:3] if cat_p[i] >= 0.05
            ],
            "severity": severity,
            "urgency": urgency,
            "safetyImpact": round(float(safety), 3),
            "signals": signals,
            "model": self.classifier_name,
            "extracted": extract_details(text),
            "details": {
                "studentCategory": category if category in CATEGORIES else None,
                "severityModel": round(severity_raw, 2),
                "urgencyModel": round(urgency_raw, 2),
                "safetyModel": round(safety_model, 3),
                "rulesApplied": rule_hits,
            },
        }

    def embed(self, text: str) -> list[float]:
        return [round(float(x), 6) for x in self.embedder.encode([text])[0]]


# ---------------------------------------------------------------- loading
def _load_classical(settings: Settings) -> ClassicalModel:
    path = settings.model_dir / CLASSICAL_FILE
    meta_path = settings.model_dir / META_FILE
    stale = False
    if path.exists() and meta_path.exists():
        trained_with = json.loads(meta_path.read_text()).get("sklearn")
        stale = trained_with != sklearn.__version__
        if stale:
            log.warning("Models were trained with scikit-learn %s but %s is installed.", trained_with, sklearn.__version__)
    if (not path.exists() or stale) and settings.auto_train:
        log.info("Training models from %s (first start or library upgrade)...", settings.data_file)
        train_models([settings.data_file], settings.model_dir)
    if not path.exists():
        raise RuntimeError(f"No trained model at {path}. Run `python -m training.train` or set AUTO_TRAIN=1.")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return ClassicalModel.load(path)


def _load_embedder(settings: Settings):
    if settings.embedder in ("auto", "sbert"):
        try:
            from .embeddings import SbertEmbedder

            emb = SbertEmbedder(settings.sbert_model)
            log.info("Embedder: %s (%d dims)", emb.name, emb.dim)
            return emb
        except Exception as err:  # not installed, or model download failed (offline)
            level = logging.WARNING if settings.embedder == "sbert" else logging.INFO
            log.log(level, "Sentence-BERT unavailable (%s); using LSA embeddings.", err.__class__.__name__)
    emb = LSAEmbedder.load(settings.model_dir / LSA_FILE)
    log.info("Embedder: %s", emb.name)
    return emb


def _load_bert(settings: Settings):
    path = settings.model_dir / "bert-category"
    if settings.classifier == "tfidf":
        return None
    if bert_available(path):
        try:
            clf = BertCategoryClassifier(path)
            log.info("Category model: %s", clf.name)
            return clf
        except Exception as err:
            log.warning("Could not load the BERT model in %s (%s); using TF-IDF.", path, err)
    elif settings.classifier == "bert":
        log.warning("CLASSIFIER=bert but %s is missing or torch/transformers are not installed; using TF-IDF.", path)
    return None


def load_analyzer(settings: Settings) -> Analyzer:
    classical = _load_classical(settings)
    return Analyzer(classical, _load_embedder(settings), _load_bert(settings))
