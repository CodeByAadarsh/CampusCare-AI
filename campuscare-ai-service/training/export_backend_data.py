"""
Exports real reports from the backend into a training CSV, so the model can learn from how students
actually write. Retrain afterwards with:  python -m training.train --extra data/real_reports.csv

  python -m training.export_backend_data ../campuscare-backend/data/campuscare-db.json data/real_reports.csv

The input can be the backend's JSON data file, or a MongoDB export
(mongoexport --collection issues --jsonArray --out issues.json).

Labels:
  category       the category saved on the report. Reports are filed in one step, so this starts as the AI's
                 own choice; it becomes a human label once a student or admin corrects it, or an admin
                 handles the report under that type. Use --resolved-only to keep just the reports an
                 admin has resolved (the safest labels).
  severity, urgency, safety_label
                 left blank for you to fill in by hand (open the CSV in Excel or Google Sheets).
                 Rows left blank still train the category model.
  --with-ai-labels pre-fills them with the AI's own predictions as a starting point for review.
                 Review them before training; unreviewed, the model only re-learns its own mistakes.
"""
import argparse
import csv
import json
from pathlib import Path

from campuscare_ai.labels import CATEGORIES


def load_issues(path: Path) -> list:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return raw.get("issues", []) if isinstance(raw, dict) else raw


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="backend data file (campuscare-db.json) or a MongoDB JSON export")
    ap.add_argument("out", nargs="?", default="data/real_reports.csv")
    ap.add_argument("--with-ai-labels", action="store_true", help="pre-fill severity/urgency/safety with the AI's predictions")
    ap.add_argument("--resolved-only", action="store_true", help="only reports an admin has resolved (category checked by a person)")
    args = ap.parse_args()

    seen, rows = set(), []
    for issue in load_issues(Path(args.source)):
        text = " ".join(str(issue.get("description", "")).split())
        category = issue.get("category")
        if args.resolved_only and issue.get("status") != "resolved":
            continue
        if len(text) < 10 or category not in CATEGORIES or text.lower() in seen:
            continue
        seen.add(text.lower())
        ai = issue.get("ai") or {}
        rows.append({
            "text": text,
            "category": category,
            "severity": ai.get("severity", "") if args.with_ai_labels else "",
            "urgency": ai.get("urgency", "") if args.with_ai_labels else "",
            "safety_label": int((ai.get("safetyImpact") or 0) >= 0.5) if args.with_ai_labels else "",
            "ticket": issue.get("ticket", ""),
        })

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["text", "category", "severity", "urgency", "safety_label", "ticket"])
        w.writeheader()
        w.writerows(rows)
    print(f"Exported {len(rows)} reports to {args.out}")


if __name__ == "__main__":
    main()
