# CampusCare AI

An Intelligent Real-Time Campus Issue Reporting and Prioritization System
(Minor Project, Dept. of ECE, BVCOE New Delhi)

| Folder | What it is |
|---|---|
| `campuscare-frontend/` | React + Vite web app (student chat reporting, admin triage board) |
| `campuscare-backend/` | Node.js/Express API, MongoDB, Socket.IO, AI triage, automatic dispatch and alerts |
| `../campuscare-ai-service/` | Python/FastAPI AI module: classification, severity, detail extraction, embeddings |

## How a report flows

1. The student describes the problem in their own words (photos optional) and presses **Send**. That is the whole form.
2. The AI classifies it, scores severity, urgency and safety risk, and **reads the details from the text**: place, when it was noticed, whether it keeps happening, how many people are affected.
3. The report is **sent to the administration automatically** with a flag level:
   - **Critical** (e.g. sparking wires, fire, someone trapped): red banner, alarm sound and live alert on every admin screen, optional Slack/Teams/Discord message; reminders every 15 min until an admin acknowledges it.
   - **High:** flagged in the bell and "Needs attention now"; reminders every 2 h.
   - **Normal:** goes into the admin queue as usual.
4. Only if no place could be found does the student get one question: "where is it?".

## Run the full system

You need Node.js 18.17+ and MongoDB (local, or a free MongoDB Atlas cluster).

**Terminal 1 – AI service** (optional; without it the backend uses its built-in rules)

```bash
cd ../campuscare-ai-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m campuscare_ai       # http://localhost:8001
```

**Terminal 2 – backend**

```bash
cd campuscare-backend
npm install
cp .env.example .env          # set MONGO_URI, JWT_SECRET, AI_SERVICE_URL=http://localhost:8001
npm run seed:reset            # demo accounts + sample reports (or: npm run ai:backfill to keep your data)
npm run dev                   # http://localhost:8000/api
```

**Terminal 3 – frontend**

```bash
cd campuscare-frontend
npm install
cp .env.example .env          # then set VITE_USE_MOCK=false
npm run dev                   # http://localhost:5173
```

**Logins** (password `demo1234`): student `student@bvcoe.edu.in`, admin `admin@bvcoe.edu.in`.

To demo the frontend alone without a backend, leave `VITE_USE_MOCK=true`.

Details are in each folder's README.
