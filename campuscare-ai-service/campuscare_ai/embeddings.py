"""
Sentence embeddings for duplicate detection. The backend stores one vector per report and compares
reports by cosine similarity (campuscare-backend/src/ai/triage.js → similarity()).

Two embedders:

  sbert  Sentence-BERT (default all-MiniLM-L6-v2, 384 numbers). Understands paraphrases, e.g.
         "lift stuck" ≈ "elevator stopped between floors". Needs `pip install sentence-transformers`
         (downloads ~90 MB on first use).
  lsa    Latent semantic analysis: TF-IDF followed by truncated SVD, trained on our own data.
         Small, fast, no extra installs. Weaker on paraphrases than SBERT.

Vectors from different embedders cannot be compared. If you switch embedders, reports stored
earlier simply fall back to word-overlap matching in the backend (it checks vector length).
"""
from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion, make_pipeline

from .text import normalize


def _unit(v: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(v, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return v / norms


class LSAEmbedder:
    def __init__(self, pipeline, dim: int):
        self.pipeline = pipeline
        self.dim = dim
        self.name = f"lsa-tfidf-{dim}"

    @classmethod
    def fit(cls, texts, dim: int = 128, seed: int = 0) -> "LSAEmbedder":
        features = FeatureUnion([
            ("word", TfidfVectorizer(preprocessor=normalize, ngram_range=(1, 2), min_df=2, sublinear_tf=True,
                                     token_pattern=r"(?u)\b[a-z][a-z']+\b")),
            ("char", TfidfVectorizer(preprocessor=normalize, analyzer="char_wb", ngram_range=(3, 5), min_df=3,
                                     sublinear_tf=True, max_features=40000)),
        ])
        pipeline = make_pipeline(features, TruncatedSVD(n_components=dim, random_state=seed))
        pipeline.fit(list(texts))
        return cls(pipeline, dim)

    def encode(self, texts) -> np.ndarray:
        return _unit(self.pipeline.transform(list(texts)))

    def save(self, path: Path) -> None:
        joblib.dump({"pipeline": self.pipeline, "dim": self.dim}, path)

    @classmethod
    def load(cls, path: Path) -> "LSAEmbedder":
        blob = joblib.load(path)
        return cls(blob["pipeline"], blob["dim"])


class SbertEmbedder:
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # optional dependency

        self.model = SentenceTransformer(model_name)
        self.dim = int(self.model.get_sentence_embedding_dimension())
        self.name = f"sbert:{model_name.split('/')[-1]}"

    def encode(self, texts) -> np.ndarray:
        return np.asarray(self.model.encode(list(texts), normalize_embeddings=True, show_progress_bar=False))


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    return float(a @ b / (na * nb)) if na and nb else 0.0
