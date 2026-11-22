"""
Classical models: one TF-IDF feature space, four logistic-regression heads.

  category  9 classes  -> type of issue (routes the report to a department)
  severity  1-5        -> how bad the problem is
  urgency   1-5        -> how soon it must be handled
  safety    0/1        -> probability that people are at risk (used as safetyImpact, 0-1)

Features are word 1-2 grams (readable, used for explanations) plus character 2-5 grams
(robust to typos, Hinglish spellings and words never seen in training).
Logistic regression is linear, so each prediction can be explained by listing the words that
pushed it towards the predicted class.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion

from .text import normalize

HEADS = ("category", "severity", "urgency", "safety")
# Words that make poor explanations on their own (English plus common Hinglish fillers).
EXPLAIN_STOP = set(ENGLISH_STOP_WORDS) | {"mein", "hai", "ka", "ki", "ke", "se", "ko", "ho", "raha", "rahi", "rahe", "got",
                                          "since", "today", "please", "sir", "maam", "ma'am", "complaint", "kindly"}
MODEL_NAME = "tfidf-logreg-v1"


def build_vectorizer() -> FeatureUnion:
    return FeatureUnion([
        ("word", TfidfVectorizer(preprocessor=normalize, ngram_range=(1, 2), min_df=2, sublinear_tf=True,
                                 token_pattern=r"(?u)\b[a-z][a-z']+\b")),
        ("char", TfidfVectorizer(preprocessor=normalize, analyzer="char_wb", ngram_range=(2, 5), min_df=3,
                                 sublinear_tf=True, max_features=60000)),
    ])


def _head(C: float) -> LogisticRegression:
    return LogisticRegression(C=C, max_iter=3000, class_weight="balanced")


class ClassicalModel:
    def __init__(self, vectorizer: FeatureUnion, heads: dict, meta: dict | None = None):
        self.vectorizer = vectorizer
        self.heads = heads
        self.meta = meta or {}
        word = vectorizer.transformer_list[0][1]
        self._word_names = word.get_feature_names_out()
        self._n_word = len(self._word_names)

    # ------------------------------------------------------------ training
    @classmethod
    def fit(cls, texts, labels: dict, C: dict | None = None) -> "ClassicalModel":
        """labels: {head: array}. Rows whose label is missing (NaN/None) are skipped for that head only."""
        C = {"category": 8.0, "severity": 4.0, "urgency": 4.0, "safety": 4.0, **(C or {})}
        texts = list(texts)
        vectorizer = build_vectorizer()
        X = vectorizer.fit_transform(texts)
        heads = {}
        for name in HEADS:
            if name not in labels:
                continue
            y = np.asarray(labels[name], dtype=object)
            keep = np.array([v is not None and not (isinstance(v, float) and np.isnan(v)) for v in y])
            if keep.sum() < 10:
                continue
            target = y[keep].astype(str) if name == "category" else y[keep].astype(float).astype(int)
            heads[name] = _head(C[name]).fit(X[keep], target)
        meta = {"model": MODEL_NAME, "rows": len(texts), "sklearn": sklearn.__version__,
                "classes": {k: [str(c) for c in h.classes_] for k, h in heads.items()}}
        return cls(vectorizer, heads, meta)

    # ------------------------------------------------------------ prediction
    def transform(self, texts):
        return self.vectorizer.transform(list(texts))

    def predict_proba(self, texts, X=None) -> dict:
        """{head: (n, n_classes) probabilities}. Class order is in .classes(head)."""
        X = self.transform(texts) if X is None else X
        return {name: head.predict_proba(X) for name, head in self.heads.items()}

    def classes(self, head: str) -> list:
        return [str(c) if head == "category" else int(c) for c in self.heads[head].classes_]

    def expected_level(self, probs: np.ndarray, head: str) -> np.ndarray:
        """Probability-weighted average of the 1-5 classes (smoother than taking the top class)."""
        levels = np.asarray(self.classes(head), dtype=float)
        return probs @ levels

    def safety_probability(self, probs: np.ndarray) -> np.ndarray:
        classes = [int(c) for c in self.classes("safety")]
        return probs[:, classes.index(1)] if 1 in classes else np.zeros(len(probs))

    # ------------------------------------------------------------ explanations
    def explain(self, X_row, head: str, class_value, top: int = 4) -> list[str]:
        """Word n-grams in this text that pushed `head` towards `class_value` the most."""
        model = self.heads[head]
        classes = list(model.classes_)
        coef = model.coef_
        if coef.shape[0] == 1:  # binary: the single row scores the positive class
            weights = coef[0] if class_value == classes[1] else -coef[0]
        else:
            weights = coef[classes.index(class_value)]
        row = X_row[:, : self._n_word].tocoo()
        contrib = sorted(((v * weights[j], j) for v, j in zip(row.data, row.col)), reverse=True)
        picked: list[str] = []
        for score, j in contrib:
            if score <= 0 or len(picked) >= top:
                break
            term = self._word_names[j]
            words = term.split()
            if words[0] in EXPLAIN_STOP or words[-1] in EXPLAIN_STOP:
                continue
            if any(term in p or p in term for p in picked):
                continue
            picked.append(term)
        return picked

    # ------------------------------------------------------------ persistence
    def save(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"vectorizer": self.vectorizer, "heads": self.heads, "meta": self.meta}, path)
        path.with_suffix(".json").write_text(json.dumps(self.meta, indent=2))

    @classmethod
    def load(cls, path: Path) -> "ClassicalModel":
        blob = joblib.load(path)
        return cls(blob["vectorizer"], blob["heads"], blob.get("meta"))
