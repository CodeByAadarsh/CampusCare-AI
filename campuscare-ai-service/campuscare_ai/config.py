"""Settings, read from environment variables (or a .env file loaded by the shell)."""
import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    model_dir: Path
    data_file: Path
    classifier: str      # auto | tfidf | bert
    embedder: str        # auto | sbert | lsa
    sbert_model: str
    auto_train: bool


def _path(value: str) -> Path:
    p = Path(value)
    return p if p.is_absolute() else ROOT / p


def load_settings() -> Settings:
    env = os.environ
    return Settings(
        model_dir=_path(env.get("MODEL_DIR", "models")),
        data_file=_path(env.get("DATA_FILE", "data/campus_issues.csv")),
        classifier=env.get("CLASSIFIER", "auto").lower(),
        embedder=env.get("EMBEDDER", "auto").lower(),
        sbert_model=env.get("SBERT_MODEL", "sentence-transformers/all-MiniLM-L6-v2"),
        auto_train=env.get("AUTO_TRAIN", "1").lower() not in ("0", "false", "no"),
    )
