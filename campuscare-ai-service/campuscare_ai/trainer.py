"""Training used by `python -m training.train` and by the service on first start (AUTO_TRAIN=1)."""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import sklearn

from .classical import ClassicalModel
from .embeddings import LSAEmbedder
from .labels import CATEGORIES

log = logging.getLogger("campuscare_ai")

CLASSICAL_FILE = "classical.joblib"
LSA_FILE = "lsa.joblib"
META_FILE = "meta.json"


def load_training_data(paths) -> pd.DataFrame:
    """Reads one or more CSVs with at least `text` and `category` columns.
    Optional columns: severity, urgency, safety_label (blank cells are allowed)."""
    frames = []
    for p in paths:
        df = pd.read_csv(p)
        missing = {"text", "category"} - set(df.columns)
        if missing:
            raise ValueError(f"{p} is missing columns: {', '.join(sorted(missing))}")
        for col in ("severity", "urgency", "safety_label"):
            if col not in df.columns:
                df[col] = None
        frames.append(df[["text", "category", "severity", "urgency", "safety_label"]])
    data = pd.concat(frames, ignore_index=True)
    data = data[data["text"].astype(str).str.strip().str.len() >= 3]
    unknown = sorted(set(data["category"]) - set(CATEGORIES))
    if unknown:
        raise ValueError(f"Unknown categories in training data: {unknown}. Allowed: {CATEGORIES}")
    return data.drop_duplicates(subset="text").reset_index(drop=True)


def train_models(data_paths, model_dir: Path, lsa_dim: int = 128) -> dict:
    started = time.time()
    model_dir = Path(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    data = load_training_data(data_paths)
    log.info("Training on %d reports from %s", len(data), ", ".join(str(p) for p in data_paths))

    classical = ClassicalModel.fit(data["text"], {
        "category": data["category"].tolist(),
        "severity": data["severity"].tolist(),
        "urgency": data["urgency"].tolist(),
        "safety": data["safety_label"].tolist(),
    })
    classical.save(model_dir / CLASSICAL_FILE)

    lsa = LSAEmbedder.fit(data["text"], dim=lsa_dim)
    lsa.save(model_dir / LSA_FILE)

    meta = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rows": len(data),
        "data": [str(p) for p in data_paths],
        "sklearn": sklearn.__version__,
        "classifier": classical.meta["model"],
        "embedder": lsa.name,
        "seconds": round(time.time() - started, 1),
    }
    (model_dir / META_FILE).write_text(json.dumps(meta, indent=2))
    log.info("Saved models to %s in %.1fs", model_dir, meta["seconds"])
    return meta
