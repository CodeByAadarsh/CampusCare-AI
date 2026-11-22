"""
Fine-tunes DistilBERT (or another BERT-style model) to predict the category of a complaint.

Best run on a GPU, e.g. Google Colab (Runtime → Change runtime type → T4 GPU):

  pip install -r requirements.txt -r requirements-transformers.txt
  python -m training.train_bert                       # ~4 epochs, a few minutes on a T4
  python -m training.train_bert --model bert-base-uncased --epochs 3

Saves the model to models/bert-category/. The service then uses it for the category automatically
(CLASSIFIER=auto), while severity, urgency, safety and the explanations still come from the TF-IDF heads.
Copy the whole models/bert-category folder to the machine that runs the service.
"""
import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split

from campuscare_ai.config import ROOT
from campuscare_ai.labels import CATEGORIES
from campuscare_ai.trainer import load_training_data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="distilbert-base-uncased")
    ap.add_argument("--data", default=str(ROOT / "data" / "campus_issues.csv"))
    ap.add_argument("--extra", nargs="*", default=[])
    ap.add_argument("--test", default=str(ROOT / "data" / "handwritten_test.csv"))
    ap.add_argument("--out", default=str(ROOT / "models" / "bert-category"))
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--max-length", type=int, default=96)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    data = load_training_data([Path(args.data), *map(Path, args.extra)])
    label2id = {c: i for i, c in enumerate(CATEGORIES)}
    id2label = {i: c for c, i in label2id.items()}
    texts = data["text"].astype(str).tolist()
    ys = [label2id[c] for c in data["category"]]
    tr_x, va_x, tr_y, va_y = train_test_split(texts, ys, test_size=0.1, random_state=args.seed, stratify=ys)
    test = pd.read_csv(args.test)
    te_x, te_y = test["text"].astype(str).tolist(), [label2id[c] for c in test["category"]]

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model, num_labels=len(CATEGORIES), id2label=id2label, label2id=label2id
    ).to(device)

    def batches(xs, ys_, shuffle):
        order = list(range(len(xs)))
        if shuffle:
            random.shuffle(order)
        for i in range(0, len(order), args.batch):
            idx = order[i : i + args.batch]
            enc = tokenizer([xs[j] for j in idx], padding=True, truncation=True, max_length=args.max_length, return_tensors="pt")
            yield {k: v.to(device) for k, v in enc.items()}, torch.tensor([ys_[j] for j in idx], device=device)

    def predict(xs):
        model.eval()
        preds = []
        with torch.no_grad():
            for enc, _ in batches(xs, [0] * len(xs), shuffle=False):
                preds += model(**enc).logits.argmax(dim=-1).tolist()
        return preds

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    total = args.epochs * math.ceil(len(tr_x) / args.batch)
    scheduler = get_linear_schedule_with_warmup(optimizer, int(0.1 * total), total)

    out = Path(args.out)
    best = -1.0
    history = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        started, losses = time.time(), []
        for enc, y in batches(tr_x, tr_y, shuffle=True):
            loss = model(**enc, labels=y).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
            losses.append(loss.item())
        va_pred = predict(va_x)
        va_f1 = f1_score(va_y, va_pred, average="macro")
        history.append({"epoch": epoch, "loss": float(np.mean(losses)), "val_macro_f1": float(va_f1)})
        print(f"epoch {epoch}: loss {np.mean(losses):.4f}  val macro-F1 {va_f1:.4f}  ({time.time() - started:.0f}s)")
        if va_f1 > best:
            best = va_f1
            out.mkdir(parents=True, exist_ok=True)
            model.save_pretrained(out)
            tokenizer.save_pretrained(out)

    # Score the best checkpoint on the hand-written test set.
    model = AutoModelForSequenceClassification.from_pretrained(out).to(device)
    te_pred = predict(te_x)
    metrics = {
        "base_model": args.model,
        "epochs": args.epochs,
        "train_rows": len(tr_x),
        "best_val_macro_f1": round(best, 4),
        "handwritten_accuracy": round(accuracy_score(te_y, te_pred), 4),
        "handwritten_macro_f1": round(f1_score(te_y, te_pred, average="macro"), 4),
        "history": history,
    }
    (out / "training_metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"Hand-written test set: accuracy {metrics['handwritten_accuracy']:.3f}, macro-F1 {metrics['handwritten_macro_f1']:.3f}")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
