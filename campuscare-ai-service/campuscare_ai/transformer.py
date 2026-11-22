"""
Optional fine-tuned transformer (DistilBERT/BERT) for the category.

Train it with training/train_bert.py (a GPU or Google Colab is recommended), which saves the model to
models/bert-category/. When that folder exists and torch + transformers are installed, the service uses
it for the category and keeps the TF-IDF heads for severity, urgency, safety and explanations.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np


class BertCategoryClassifier:
    def __init__(self, path: Path, max_length: int = 128):
        import torch  # optional dependency
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(str(path))
        self.model = AutoModelForSequenceClassification.from_pretrained(str(path))
        self.model.eval()
        id2label = {int(k): v for k, v in self.model.config.id2label.items()}
        self.labels = [id2label[i] for i in range(len(id2label))]
        self.max_length = max_length
        self.name = f"bert:{Path(path).name}"

    def predict_proba(self, texts) -> np.ndarray:
        enc = self.tokenizer(list(texts), padding=True, truncation=True, max_length=self.max_length, return_tensors="pt")
        with self.torch.no_grad():
            logits = self.model(**enc).logits
        return self.torch.softmax(logits, dim=-1).cpu().numpy()


def bert_available(path: Path) -> bool:
    if not (Path(path) / "config.json").exists():
        return False
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True
