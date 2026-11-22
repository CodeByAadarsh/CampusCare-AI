# CampusCare AI – AI service

The AI module of **CampusCare AI: An Intelligent Real-Time Campus Issue Reporting and Prioritization System**
(Minor Project, Dept. of ECE, BVCOE New Delhi).

It is a small Python (FastAPI) service that the Node backend calls for every report:

- **Classifies** the complaint into one of 9 issue types, which decides the department it is routed to.
- **Estimates** severity (1–5), urgency (1–5) and safety risk (0–1). The backend turns these into the 0–100 priority score.
- **Explains** each prediction with the words that drove it (shown to students as "Picked up from your words").
- **Embeds** each report as a vector, so the backend can spot duplicates even when they are worded differently.
- **Reads the details** from the complaint text: place, when it was noticed, whether it keeps happening and how many people are affected (`campuscare_ai/extract.py`). The backend uses them to file the report in one step and to decide how urgently it is sent to the admins.

```
Student ──► React app ──► Node/Express backend ──POST /analyze, /embed──► this service
                                   │  (falls back to its own rules if the service is down)
                                   └─► priority score, flag level, routing, duplicate check,
                                       automatic dispatch + alerts to admins
```

## Quick start

Needs Python 3.10 or newer.

```bash
cd campuscare-ai-service
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m campuscare_ai              # http://localhost:8001  (trains the models on first start, ~20 s)
```

Open http://localhost:8001/docs to try every endpoint in the browser.

### Connect the backend

1. In `campuscare-backend/.env`, set:
   ```
   AI_SERVICE_URL=http://localhost:8001
   ```
2. Restart the backend. Check http://localhost:8000/api/health: it should show `"engine": "ai-service"` and `"status": "up"`.
3. Optional: bring existing reports up to date (embeddings for duplicate detection, plus the flag level and extracted details). Nothing is deleted, and the server can keep running.
   ```bash
   cd campuscare-backend
   npm run ai:backfill          # or: npm run seed:reset (stop the server first) to start fresh with sample data
   ```

Start the AI service before the backend. If the service is down, the backend keeps working with its built-in keyword engine and switches back automatically when the service returns.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/analyze` | `{ "description": "...", "category"?: "..." }` | `category, confidence, alternatives[], severity, urgency, safetyImpact, signals[], model, extracted, details` |
| POST | `/embed` | `{ "text": "..." }` | `{ embedding: number[], dim, model }` |
| POST | `/extract` | `{ "text": "..." }` | `{ location, occurredAt, whenText, recurring, peopleCount, manyAffected, missing[] }` |
| POST | `/similarity` | `{ "a": "...", "b": "..." }` | `{ similarity, model }`, handy for demos |
| GET | `/health` | | `{ ok, classifier, embedder, version }` |
| GET | `/info` | | categories, model details, latest evaluation summary |

```bash
curl -s localhost:8001/analyze -H 'Content-Type: application/json' \
  -d '{"description": "The switchboard in ECE Lab 3 is sparking and wires are exposed"}'
```
```json
{
  "category": "electrical", "confidence": 0.999, "alternatives": [],
  "severity": 5, "urgency": 4, "safetyImpact": 0.99,
  "signals": ["sparking", "exposed wiring", "exposed", "wires", "switchboard"],
  "model": "tfidf-logreg-v1",
  "extracted": { "location": "ECE Lab 3", "occurredAt": null, "whenText": null, "recurring": false, "peopleCount": null, "manyAffected": false, "missing": [] },
  "details": { "studentCategory": null, "severityModel": 4.99, "urgencyModel": 3.73, "safetyModel": 0.99, "rulesApplied": ["sparking", "exposed wiring"] }
}
```

```bash
curl -s localhost:8001/extract -H 'Content-Type: application/json' \
  -d '{"text": "The lift in Block C is stuck between floors since 9 am, 3 students are inside"}'
```
```json
{ "location": "Block C · Lift", "occurredAt": "2026-10-17T09:00:00.000Z", "whenText": "since 9 am",
  "recurring": false, "peopleCount": 3, "manyAffected": true, "missing": [] }
```

`occurredAt` is UTC. Times like "since 9 am" are read in the service's local time zone, so run it in the campus time zone (set `TZ=Asia/Kolkata` if the server is elsewhere).

`category` in the request (a correction from the student or admin) is optional. The response always carries the model's own prediction, so the backend can store both.

## How it works

```
text ─► clean-up ─► TF-IDF features ─┬─► category head (9 classes)  ─┐
       (lower-case,  word 1–2 grams  ├─► severity head (1–5)          ├─► safety rules ─► response
        wifi/wi-fi,  + char 2–5 grams├─► urgency head  (1–5)          │   (raise only)    + top words
        numbers)                     └─► safety head   (risk 0–1)    ─┘
text ─► embedder (LSA or Sentence-BERT) ─► unit vector ─► stored by the backend for duplicate matching
```

- **TF-IDF + logistic regression.** Word n-grams carry meaning ("exposed wire"). Character n-grams cope with typos, Hinglish spellings ("pani", "kharab") and unseen words. Logistic regression is linear, so every prediction can be explained by the words that pushed it.
- **Severity and urgency** are the probability-weighted average of the 1–5 classes, which is steadier than picking the top class.
- **Safety rules** (`campuscare_ai/rules.py`). Rare but dangerous reports (fire, electric shock, sparking, exposed wires, harassment, ragging, violence, collapse, people trapped, unsafe driving) get minimum severity, urgency and safety scores. Missing one of those costs far more than over-rating a small issue. The rules never lower a score, and each match appears in `signals`.
- **Embeddings.** LSA (TF-IDF reduced to 128 numbers by truncated SVD) works out of the box. Sentence-BERT (`all-MiniLM-L6-v2`, 384 numbers) understands paraphrases better and is used automatically once installed. The backend compares vectors by cosine similarity, then adds bonuses for the same place and category.
- **Detail extraction** (`campuscare_ai/extract.py`) is rule-based on purpose: named campus places (blocks, labs, hostels, library, canteen, bus routes…) plus room and floor numbers, relative times in English and Hinglish ("since 10 minutes", "yesterday", "subah se", "kal se"), recurrence words and head counts. Rules are predictable and need no labelled data. The backend has the same rules in JavaScript (`src/ai/extract.js`) as a fallback, and both are checked against the same 30 cases in `tests/extraction_cases.json`.
- **Optional BERT.** A fine-tuned DistilBERT can replace the TF-IDF category head (see below). Severity, urgency, safety and explanations still come from the TF-IDF heads.

## Results

From `python -m training.evaluate`. The full report is in `reports/evaluation.md`, with a confusion matrix image.

| Test set | Category accuracy | Severity within ±1 | Urgency within ±1 | Safety recall |
|---|---|---|---|---|
| **Test set**, 90 hand-written complaints, model + rules | **81.1%** | 94.4% | 92.2% | 71.4% |
| Same 90 complaints, backend keyword engine | 73.3% | 77.8% | 82.2% | 25.0% |
| Development set, 162 hand-written, model + rules | 95.1% | 98.8% | 98.2% | 85.2% |
| Same 162 complaints, backend keyword engine | 66.0% | 79.6% | 80.9% | 27.8% |
| Held-out phrasings (908 generated sentences with unseen wording) | 77.9% | 97.8% | 97.6% | 65.9% |

Duplicate detection on 40 labelled pairs (ROC AUC, 1.0 = perfect): LSA 0.877 vs word overlap 0.815. Analysis takes about 4 ms per report on a laptop CPU.

How to read these numbers honestly:

- **The test set is the number to quote.** It was written before the last round of improvements and never used to make any decision.
- **The development set is optimistic.** It was used once for error analysis, which led to adding missing vocabulary and risk phrases to the generator. The gap between the dev and test results is exactly that tuning.
- **Every hand-written set was written by the developers**, not collected from students. Real reports will differ. The plan is to export real reports from the backend, label them, and retrain (see below).
- **The sets are small** (90 test complaints), so differences of a few percent are noise. The weakest category is classrooms & labs, which overlaps with IT and electrical.

## Data

| File | What it is |
|---|---|
| `data/campus_issues.csv` | ~4,500 generated training reports: ~100 issue types × campus locations, durations, impact and urgency phrases, risk statements, Hinglish variants and typos. Created by `data/generate_dataset.py` (seeded, reproducible). |
| `data/handwritten_dev.csv` | 162 hand-written complaints. Development set, used for error analysis. |
| `data/handwritten_test.csv` | 90 hand-written complaints. Final test set. |
| `data/duplicate_pairs.csv` | 40 sentence pairs: 20 duplicates, 20 different issues (same or different category). |

**Labelling rules for the generated data** (also at the top of `generate_dataset.py`):

- **Category:** taken from the issue type.
- **Severity:** the issue type's base severity. A risk statement raises it to at least 4.
- **Urgency:** a base value, plus 1 each for a long duration, many students affected, an exam deadline, an explicit request for urgency, or a risk statement.
- **Safety:** the issue type's base risk. A risk statement raises it to at least 0.8.

### Learning from real reports

Reports are filed in one step, so a stored category starts as the AI's own choice. It becomes a real label once a student or admin corrects it, or an admin resolves the report under that type, so export with `--resolved-only` for the safest labels.

```bash
mongoexport --uri "<your MONGO_URI>" --collection issues --jsonArray --out issues.json
python -m training.export_backend_data issues.json data/real_reports.csv --resolved-only
# optional: open the CSV and fill in severity / urgency / safety_label by hand (blank rows still train the category)
python -m training.train --extra data/real_reports.csv
python -m training.evaluate
```

`--with-ai-labels` pre-fills severity, urgency and safety with the AI's own predictions as a starting point. Review them before training. Unreviewed, the model just re-learns its own mistakes.

## Upgrades

**Sentence-BERT embeddings** give better duplicate detection, especially for differently worded reports of the same problem.

```bash
pip install -r requirements-transformers.txt     # PyTorch + sentence-transformers (~1 GB)
python -m campuscare_ai                          # EMBEDDER=auto picks Sentence-BERT (downloads ~90 MB once)
# then recompute the stored vectors (their size changes from 128 to 384):
cd ../campuscare-backend && npm run ai:backfill -- --all
```

Until you run the backfill, older reports fall back to word-overlap matching. Nothing breaks.

**Fine-tuned DistilBERT** for the category: open `notebooks/train_bert_colab.ipynb` in Google Colab with a GPU, or run `python -m training.train_bert` on a machine with one. Copy the resulting `models/bert-category/` folder into `models/` and restart. With `CLASSIFIER=auto` the service picks it up and `/health` shows `bert:bert-category+tfidf-logreg-v1`. Re-run `python -m training.evaluate` to compare it with TF-IDF on the same test set.

## Training, evaluation, tests

```bash
python data/generate_dataset.py          # regenerate the training data
python -m training.train                 # train the TF-IDF models + LSA embedder into models/
python -m training.evaluate              # writes reports/metrics.json, evaluation.md, confusion_matrix.png
                                         # (also scores the backend keyword engine if node and ../campuscare-backend exist)
pip install -r requirements-dev.txt
pytest -q                                # rules, detail extraction, training data checks, model behaviour, HTTP API
```

## Settings

All optional. Set them as environment variables; `.env.example` lists them.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8001` / `127.0.0.1` | where the service listens |
| `MODEL_DIR` | `models` | trained model files |
| `AUTO_TRAIN` | `1` | train on first start, or after a scikit-learn upgrade |
| `CLASSIFIER` | `auto` | `auto`, `tfidf` or `bert` |
| `EMBEDDER` | `auto` | `auto`, `sbert` or `lsa` |
| `SBERT_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Sentence-BERT model name |

### Docker

```bash
docker build -t campuscare-ai .
docker run -p 8001:8001 campuscare-ai
```

## Folder structure

```
campuscare_ai/
  api.py           FastAPI app (routes, request/response schemas, startup)
  analyzer.py      combines models, rules, explanations; loads everything at startup
  classical.py     TF-IDF features + 4 logistic-regression heads, explanations
  embeddings.py    LSA and Sentence-BERT embedders
  transformer.py   optional fine-tuned BERT category model
  rules.py         safety guardrails
  extract.py       place, time noticed, recurrence and people affected, read from the text
  trainer.py       training used by the CLI and by auto-train
  text.py          shared text clean-up
  labels.py        category ids (same as the backend)
  config.py        settings from environment variables
training/
  train.py               train TF-IDF models + LSA embedder
  train_bert.py          fine-tune DistilBERT/BERT
  evaluate.py            metrics, report, confusion matrix, duplicate detection, keyword-engine comparison
  export_backend_data.py real reports → training CSV
  keyword_baseline.mjs   runs the backend's keyword engine for comparison
data/        training data, hand-written dev/test sets, duplicate pairs, generator
reports/     latest evaluation (metrics.json, evaluation.md, confusion_matrix.png)
notebooks/   Colab notebook for BERT fine-tuning
tests/       pytest suite (extraction_cases.json is shared with the backend's JavaScript rules)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend health shows `"status": "down"` | Start this service first, and check `AI_SERVICE_URL` (no trailing path, e.g. `http://localhost:8001`). |
| `/health` shows `lsa-tfidf-128` although you installed sentence-transformers | The model download failed (offline?). Check the service log, or set `EMBEDDER=sbert` to see the error as a warning. |
| Log says the models were trained with a different scikit-learn | Expected after upgrading. It retrains automatically (`AUTO_TRAIN=1`). |
| Duplicates are no longer suggested for old reports | You switched embedder. Run `npm run ai:backfill -- --all` in the backend. |
| A place in your campus is not picked up | Add its name to the place list in `campuscare_ai/extract.py` **and** `campuscare-backend/src/ai/extract.js` (and the frontend copy in `src/lib/extract.js`), add a case to `tests/extraction_cases.json`, then run `pytest` and `npm run test:extract`. |
| A report was clearly mis-classified | Add a few similar sentences to the generator or a real-reports CSV, retrain, and re-run the evaluation. |
