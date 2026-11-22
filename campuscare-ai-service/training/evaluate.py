"""
Measures the AI module and writes reports/metrics.json, reports/evaluation.md and reports/confusion_matrix.png.

Test sets
  1. Held-out phrasings  The generated data split by template: every test sentence uses a wording the
                         model never saw. A fresh model is trained on the other 80% for this test.
  2. Hand-written        data/handwritten_dev.csv (162) and data/handwritten_test.csv (90): complaints written
                         the way students write (informal, Hinglish, typos, borderline cases). Never used for
                         training. The dev set was used for error analysis; the test set for nothing else.
                         Scored with the production model in models/.
  3. Duplicate pairs     data/duplicate_pairs.csv: does the embedding give reports of the same problem a
                         higher similarity than reports of different problems?

  python -m training.evaluate                                   # also runs the backend keyword engine if node is installed
  python -m training.evaluate --backend ../campuscare-backend
"""
import argparse
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

from campuscare_ai.analyzer import Analyzer, load_analyzer
from campuscare_ai.classical import ClassicalModel
from campuscare_ai.config import ROOT, load_settings
from campuscare_ai.embeddings import LSAEmbedder, cosine
from campuscare_ai.labels import CATEGORIES

REPORTS = ROOT / "reports"


# ---------------------------------------------------------------- scoring
def score(truth: pd.DataFrame, pred: pd.DataFrame) -> dict:
    y, p = truth["category"].tolist(), pred["category"].tolist()
    prec, rec, f1, sup = precision_recall_fscore_support(y, p, labels=CATEGORIES, zero_division=0)
    sev_err = (pred["severity"].values - truth["severity"].values)
    urg_err = (pred["urgency"].values - truth["urgency"].values)
    safe_true = truth["safety_label"].astype(int).values
    safe_pred = (pred["safetyImpact"].values >= 0.5).astype(int)
    sp, sr, sf, _ = precision_recall_fscore_support(safe_true, safe_pred, average="binary", zero_division=0)
    critical = truth["severity"].values >= 5
    return {
        "n": len(truth),
        "category_accuracy": round(accuracy_score(y, p), 4),
        "category_macro_f1": round(f1_score(y, p, labels=CATEGORIES, average="macro", zero_division=0), 4),
        "per_category": {c: {"precision": round(prec[i], 3), "recall": round(rec[i], 3), "f1": round(f1[i], 3), "n": int(sup[i])}
                         for i, c in enumerate(CATEGORIES)},
        "severity_mae": round(float(np.abs(sev_err).mean()), 3),
        "severity_within_1": round(float((np.abs(sev_err) <= 1).mean()), 4),
        "urgency_mae": round(float(np.abs(urg_err).mean()), 3),
        "urgency_within_1": round(float((np.abs(urg_err) <= 1).mean()), 4),
        "safety_precision": round(float(sp), 4),
        "safety_recall": round(float(sr), 4),
        "safety_f1": round(float(sf), 4),
        "critical_flagged": round(float((pred["severity"].values[critical] >= 4).mean()), 4) if critical.any() else None,
        "confusion": confusion_matrix(y, p, labels=CATEGORIES).tolist(),
    }


def run_analyzer(analyzer: Analyzer, texts) -> tuple[pd.DataFrame, pd.DataFrame, float]:
    """Returns (with rules, model only, ms per report)."""
    full, raw = [], []
    started = time.perf_counter()
    for t in texts:
        r = analyzer.analyze(t)
        d = r["details"]
        full.append({"category": r["category"], "severity": r["severity"], "urgency": r["urgency"], "safetyImpact": r["safetyImpact"]})
        raw.append({"category": r["category"], "severity": int(min(5, max(1, round(d["severityModel"])))),
                    "urgency": int(min(5, max(1, round(d["urgencyModel"])))), "safetyImpact": d["safetyModel"]})
    ms = (time.perf_counter() - started) * 1000 / max(1, len(texts))
    return pd.DataFrame(full), pd.DataFrame(raw), ms


# ---------------------------------------------------------------- duplicates
_STOP = set("a an the is are was were be been am i me my we our you your it its this that these those of in on at to for from "
            "with and or but not no so very too there here has have had do does did can could will would should just also near "
            "since by as up down out over again still please sir maam ma am".split())


def _stem(w):
    if len(w) > 5 and w.endswith("ing"): return w[:-3]
    if len(w) > 4 and w.endswith("ed"): return w[:-2]
    if len(w) > 3 and w.endswith("es"): return w[:-2]
    if len(w) > 3 and w.endswith("s"): return w[:-1]
    return w


def backend_word_overlap(a: str, b: str) -> float:
    """Python copy of the backend's fallback similarity (bag-of-words cosine, campuscare-backend/src/ai/triage.js)."""
    def vec(t):
        toks = [_stem(w) for w in re.split(r"[\s-]+", re.sub(r"[^a-z0-9\s-]", " ", t.lower())) if len(w) > 1 and w not in _STOP]
        v = {}
        for w in toks:
            v[w] = v.get(w, 0) + 1
        return v
    va, vb = vec(a), vec(b)
    dot = sum(x * vb.get(k, 0) for k, x in va.items())
    na, nb = sum(x * x for x in va.values()) ** 0.5, sum(x * x for x in vb.values()) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def duplicate_scores(pairs: pd.DataFrame, name: str, fn) -> dict:
    s = np.array([fn(a, b) for a, b in zip(pairs["text_a"], pairs["text_b"])])
    y = pairs["duplicate"].values
    thresholds = np.unique(s)
    accs = [((s >= t).astype(int) == y).mean() for t in thresholds]
    best = int(np.argmax(accs))
    return {
        "method": name,
        "roc_auc": round(float(roc_auc_score(y, s)), 4),
        "mean_duplicate": round(float(s[y == 1].mean()), 3),
        "mean_same_category": round(float(s[pairs["kind"] == "same category"].mean()), 3),
        "mean_different_category": round(float(s[pairs["kind"] == "different category"].mean()), 3),
        "best_threshold": round(float(thresholds[best]), 3),
        "accuracy_at_best": round(float(accs[best]), 4),
    }


# ---------------------------------------------------------------- report
def confusion_png(conf, path: Path, title: str):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    m = np.array(conf)
    fig, ax = plt.subplots(figsize=(7.2, 6))
    ax.imshow(m, cmap="Blues")
    ax.set_xticks(range(len(CATEGORIES)), CATEGORIES, rotation=45, ha="right")
    ax.set_yticks(range(len(CATEGORIES)), CATEGORIES)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title(title)
    for i in range(len(m)):
        for j in range(len(m)):
            if m[i, j]:
                ax.text(j, i, int(m[i, j]), ha="center", va="center", color="white" if m[i, j] > m.max() / 2 else "black", fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def pct(x):
    return "–" if x is None else f"{x * 100:.1f}%"


def write_markdown(m: dict, path: Path):
    rows = [("Held-out phrasings (generated)", m["heldout"]["with_rules"])]
    for key, label in (("dev", "Development set"), ("test", "Test set")):
        if key not in m:
            continue
        rows += [(f"{label}: model only", m[key]["model_only"]), (f"{label}: model + safety rules", m[key]["with_rules"])]
        if m[key].get("baseline"):
            rows.append((f"{label}: keyword engine (backend built-in)", m[key]["baseline"]))
    lines = [
        "# CampusCare AI – evaluation", "",
        f"Classifier: `{m['classifier']}` · Embedder: `{m['embedder']}` · Average analysis time: {m['ms_per_report']:.1f} ms per report", "",
        "## Classification and triage", "",
        "| Test set | n | Category accuracy | Macro-F1 | Severity within ±1 | Severity MAE | Urgency within ±1 | Safety recall | Safety precision | Critical reports flagged (sev ≥ 4) |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for name, r in rows:
        lines.append(f"| {name} | {r['n']} | {pct(r['category_accuracy'])} | {r['category_macro_f1']:.3f} | {pct(r['severity_within_1'])} | "
                     f"{r['severity_mae']:.2f} | {pct(r['urgency_within_1'])} | {pct(r['safety_recall'])} | {pct(r['safety_precision'])} | {pct(r['critical_flagged'])} |")
    final = m["test" if "test" in m else "dev"]["with_rules"]["per_category"]
    lines += ["", "## Per category (test set, production model)", "", "| Category | Precision | Recall | F1 | n |", "|---|---|---|---|---|"]
    lines += [f"| {c} | {v['precision']:.2f} | {v['recall']:.2f} | {v['f1']:.2f} | {v['n']} |" for c, v in final.items()]
    lines += ["", "![Confusion matrix](confusion_matrix.png)", "", "## Duplicate detection (text similarity only)", "",
              "| Method | ROC AUC | Mean: duplicates | Mean: same category, different issue | Mean: different category | Best threshold | Accuracy at best |",
              "|---|---|---|---|---|---|---|"]
    for d in m["duplicates"]:
        lines.append(f"| {d['method']} | {d['roc_auc']:.3f} | {d['mean_duplicate']:.2f} | {d['mean_same_category']:.2f} | "
                     f"{d['mean_different_category']:.2f} | {d['best_threshold']:.2f} | {pct(d['accuracy_at_best'])} |")
    lines += ["", "## How to read this", "",
              "- **Held-out phrasings**: generated sentences whose wording was never seen in training. Shows the model learned the categories, not the sentences.",
              "- **Development set** (`data/handwritten_dev.csv`, 162 hand-written complaints): used once for error analysis, which led to adding missing vocabulary and risk phrases to the generator. Its scores are therefore slightly optimistic.",
              "- **Test set** (`data/handwritten_test.csv`, 90 hand-written complaints): written before that change and never used for any decision. This is the number to quote.",
              "- **Safety rules** only raise scores. Compare the *model only* and *model + safety rules* rows to see what they add.",
              "- **Keyword engine** is the rule-based triage built into the backend, used when this service is not running.",
              "- **Duplicate detection**: in the backend the final score also adds 0.15 for the same place and 0.10 for the same category; 0.62 counts as a likely duplicate.",
              "- All hand-written sets were written by the developers, not collected from students. Retrain with real exported reports once the system is in use.", ""]
    path.write_text("\n".join(lines))


def keyword_baseline(backend: Path, csv_path: Path):
    """Runs the backend keyword engine through node; returns None if node or the backend is not available."""
    script = ROOT / "training" / "keyword_baseline.mjs"
    out = REPORTS / f"keyword_{Path(csv_path).stem}.json"
    if not shutil.which("node") or not (backend / "src" / "ai" / "triage.js").exists():
        return None
    subprocess.run(["node", str(script), str(backend), str(csv_path), str(out)], check=True, capture_output=True)
    return pd.DataFrame(json.loads(out.read_text()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(ROOT / "data" / "campus_issues.csv"))
    ap.add_argument("--dev", default=str(ROOT / "data" / "handwritten_dev.csv"))
    ap.add_argument("--test", default=str(ROOT / "data" / "handwritten_test.csv"))
    ap.add_argument("--pairs", default=str(ROOT / "data" / "duplicate_pairs.csv"))
    ap.add_argument("--backend", default=str(ROOT.parent / "campuscare-backend"),
                    help="backend folder, to compare with its keyword engine (needs node)")
    args = ap.parse_args()
    REPORTS.mkdir(exist_ok=True)

    # 1. held-out phrasings
    gen = pd.read_csv(args.data)
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42).split(gen, groups=gen["template_id"]))
    train, test = gen.iloc[tr], gen.iloc[te].reset_index(drop=True)
    held_model = ClassicalModel.fit(train["text"], {"category": train["category"].tolist(), "severity": train["severity"].tolist(),
                                                     "urgency": train["urgency"].tolist(), "safety": train["safety_label"].tolist()})
    held_full, held_raw, _ = run_analyzer(Analyzer(held_model, embedder=None), test["text"])

    # 2. hand-written sets with the production model
    analyzer = load_analyzer(load_settings())
    metrics = {"classifier": analyzer.classifier_name, "embedder": analyzer.embedder.name,
               "heldout": {"with_rules": score(test, held_full), "model_only": score(test, held_raw), "train_rows": len(train)}}
    timings = []
    for key, path in (("dev", args.dev), ("test", args.test)):
        if not Path(path).exists():
            continue
        df = pd.read_csv(path)
        full, raw, ms = run_analyzer(analyzer, df["text"])
        timings.append(ms)
        metrics[key] = {"file": Path(path).name, "with_rules": score(df, full), "model_only": score(df, raw)}
        base = keyword_baseline(Path(args.backend), Path(path))
        if base is not None:
            metrics[key]["baseline"] = score(df, base)
    metrics["ms_per_report"] = round(float(np.mean(timings)), 2) if timings else None

    # 3. duplicate pairs
    pairs = pd.read_csv(args.pairs)
    emb = analyzer.embedder
    methods = [("Word overlap (backend fallback)", backend_word_overlap), (emb.name, lambda a, b: cosine(*emb.encode([a, b])))]
    if not emb.name.startswith("lsa"):
        lsa = LSAEmbedder.load(load_settings().model_dir / "lsa.joblib")
        methods.append((lsa.name, lambda a, b: cosine(*lsa.encode([a, b]))))
    metrics["duplicates"] = [duplicate_scores(pairs, n, f) for n, f in methods]

    final_key = "test" if "test" in metrics else "dev"
    final = metrics[final_key]["with_rules"]
    metrics["summary"] = {
        "set": metrics[final_key]["file"],
        "category_accuracy": final["category_accuracy"],
        "category_macro_f1": final["category_macro_f1"],
        "severity_within_1": final["severity_within_1"],
        "urgency_within_1": final["urgency_within_1"],
        "safety_recall": final["safety_recall"],
        "keyword_engine_category_accuracy": metrics[final_key].get("baseline", {}).get("category_accuracy"),
        "duplicate_auc": {d["method"]: d["roc_auc"] for d in metrics["duplicates"]},
    }

    (REPORTS / "metrics.json").write_text(json.dumps(metrics, indent=2))
    confusion_png(final["confusion"], REPORTS / "confusion_matrix.png", f"{metrics[final_key]['file']} – category (n={final['n']})")
    write_markdown(metrics, REPORTS / "evaluation.md")

    print(f"{'':44s} {'n':>4s} {'cat acc':>8s} {'macroF1':>8s} {'sev±1':>7s} {'urg±1':>7s} {'safe R':>7s} {'safe P':>7s}")
    show = [("held-out phrasings (model + rules)", metrics["heldout"]["with_rules"])]
    for key in ("dev", "test"):
        if key in metrics:
            show += [(f"{key} (model only)", metrics[key]["model_only"]), (f"{key} (model + rules)", metrics[key]["with_rules"])]
            if "baseline" in metrics[key]:
                show.append((f"{key} (keyword engine)", metrics[key]["baseline"]))
    for name, r in show:
        print(f"{name:44s} {r['n']:4d} {r['category_accuracy']:8.3f} {r['category_macro_f1']:8.3f} {r['severity_within_1']:7.3f} "
              f"{r['urgency_within_1']:7.3f} {r['safety_recall']:7.3f} {r['safety_precision']:7.3f}")
    for d in metrics["duplicates"]:
        print(f"duplicates – {d['method']:34s} AUC {d['roc_auc']:.3f}  dup {d['mean_duplicate']:.2f}  "
              f"same-cat {d['mean_same_category']:.2f}  diff-cat {d['mean_different_category']:.2f}")
    print(f"{metrics['ms_per_report']} ms per report · reports written to {REPORTS}")


if __name__ == "__main__":
    main()
