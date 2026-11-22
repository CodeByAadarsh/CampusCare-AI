# CampusCare AI – Backend

Node.js / Express REST API + MongoDB (Mongoose) + Socket.IO for **CampusCare AI: An Intelligent Real-Time Campus Issue Reporting and Prioritization System** (Minor Project, Dept. of ECE, BVCOE New Delhi).

It is built to the exact contract the React frontend (`campuscare-frontend`) already uses, so the frontend switches from demo mode to this server by changing one setting.

## What it does

- **Accounts:** student self sign-up, login for students and administrators, JWT sessions, role checks on every route.
- **One-step reports:** the student only writes a description (plus up to 3 photos). The AI reads the place, when it was noticed, whether it keeps happening and how many people are affected from the text, and fills the report itself.
- **Automatic dispatch to admins:** every report is sent to the administration as soon as it is created, with a flag level (critical / high / normal) worked out from the severity, urgency and safety scores. Critical and high reports raise a live alert for admins, wait for an admin to acknowledge them, and are re-sent as reminders if nobody does. Optionally the alert also goes to a Slack / Teams / Discord channel.
- **Reports:** list and filter, list and filter, "my reports", detail view, comments, status changes with notes, assignment and re-routing.
- **AI triage on every report:**
  - classifies the issue into 1 of 9 types and routes it to 1 of 8 departments
  - estimates severity, urgency and safety risk
  - computes a 0–100 priority score
- **Duplicate handling:** similar open reports are flagged before submission, and students can join an existing report ("same problem, add me"). Admins confirm or dismiss AI suggestions and merge reports. Merging adds the affected students together and raises the priority.
- **Dashboard numbers:** counts by status, open load per department and type, average time to resolve.
- **Real time:** Socket.IO pushes `issue:created` and `issue:updated` to admins and to the students involved, and `issue:flagged` to admins only.

## Run it

**You need:** Node.js 18.17 or newer, and MongoDB. Use either a local install, or a free MongoDB Atlas cluster.

```bash
cd campuscare-backend
npm install
cp .env.example .env        # then edit MONGO_URI and JWT_SECRET
npm run seed:reset          # demo accounts + 15 sample reports (stop the server first)
npm run dev                 # http://localhost:8000/api  (auto-restarts on file changes)
```

Check it is up: open http://localhost:8000/api/health. It should show `{"ok":true,"db":"connected",...}`.

**Demo accounts** (password `demo1234`):

| Role | Email |
|---|---|
| Student | `student@bvcoe.edu.in`, `aman@…`, `kabir@…`, `neha@bvcoe.edu.in` |
| Administrator | `admin@bvcoe.edu.in` |

New students can also create an account from the login screen. Administrators are only created by the seed script, never by self sign-up.

### Upgrading an existing database

Reports filed before automatic dispatch have no flag level or extracted details. Add them without losing anything:

```bash
npm run ai:backfill        # adds dispatch + extracted details (+ embeddings if the AI service is up)
```

Reports that an admin has already moved past "new" count as acknowledged; older critical/high reports still "new" appear in the admins' alert list.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | start with auto-restart |
| `npm run seed:reset` | wipe and reload demo accounts + sample reports |
| `npm run ai:backfill` | bring old reports up to date (`-- --all` also recomputes every embedding) |
| `npm run test:extract` | check the detail-extraction rules against the 30 shared test cases |

### Connect the frontend

In `campuscare-frontend/.env`:

```
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:8000/api
VITE_SOCKET_URL=http://localhost:8000
```

Then run `npm run dev` in the frontend. Keep `CLIENT_ORIGIN=http://localhost:5173` in the backend `.env` (comma-separate several origins if needed).

Open a student window and an admin window side by side. A report submitted by the student appears on the admin board instantly, and status changes reach the student instantly.

## Folder structure

```
src/
  server.js              starts HTTP + Socket.IO after MongoDB connects
  app.js                 Express app: CORS, JSON, routes, uploads, errors
  config.js              reads .env
  db.js                  Mongoose connection
  constants.js           categories, departments, statuses, priority bands (same file as the frontend)
  models/                User, Issue, Counter (ticket numbers)
  middleware/            auth (JWT, roles), upload (multer), errors
  routes/                auth.routes, issues.routes, stats.routes
  services/
    issue.service.js     all report logic: triage, extraction, dispatch, alerts, reminders, duplicates, merge, stats
    alerts.js            optional Slack / Teams / Discord webhook
  ai/
    index.js             AI facade: external model service if configured, else built-in engine
    triage.js            built-in classifier, severity/urgency, priority formula, similarity
    extract.js           reads place, time, recurrence and people affected from the description
    dispatch.js          flag level (critical / high / normal) and the reasons for it
  realtime/socket.js     Socket.IO auth, rooms, emit helper
  seed/seed.js           demo data
scripts/test-extract.mjs checks extract.js against the shared cases in campuscare-ai-service/tests
uploads/                 stored photos (served at /api/uploads/…)
```

## API

Base URL `/api`. Send JSON, except report creation, which is `multipart/form-data`. Authenticated routes need `Authorization: Bearer <token>`. Errors always come back as `{ "message": "…" }` with a fitting status code.

| Method | Path | Who | Body / query | Returns |
|---|---|---|---|---|
| POST | `/auth/login` | anyone | `{ email, password, role }` | `{ token, user }` |
| POST | `/auth/register` | anyone | `{ name, email, password, enrollment?, branch? }` | `{ token, user }` |
| GET | `/auth/me` | signed in | | `user` |
| GET | `/issues` | admin | `status` (`open`, `high`, `flagged`, `all`, or a status), `category`, `department`, `level`, `search`, `sort` (`priority`, `newest`, `oldest`) | `{ items, total }` |
| GET | `/issues/mine` | signed in | | `{ items }` |
| POST | `/issues/analyze` | signed in | `{ description, category?, location? }` | `{ ai, priority, department, similar[], extracted, dispatch }` (preview while typing) |
| POST | `/issues` | signed in | form: `description`, `images` (≤3, ≤5 MB); optional `category`, `location`, `occurredAt` override what the AI read | issue + `possibleDuplicates[]` (201) |
| PATCH | `/issues/:id/details` | reporter or admin | `{ location?, category? }` | issue (fixes what the AI read) |
| GET | `/issues/alerts` | admin | | `{ items, counts: { critical, high } }` (flagged, not yet acknowledged) |
| POST | `/issues/:id/acknowledge` | admin | | issue |
| GET | `/issues/:id` | admin, reporter or joined students | `:id` = id or ticket (`CC-26-0147`) | issue + `parent`, `merged[]`, `related[]` |
| POST | `/issues/:id/join` | signed in | | issue |
| POST | `/issues/:id/comments` | admin, reporter or joined students | `{ text }` | issue |
| PATCH | `/issues/:id/status` | admin | `{ status, note? }` | issue |
| PATCH | `/issues/:id/assign` | admin | `{ department?, assignee? }` | issue |
| POST | `/issues/:id/merge` | admin | `{ into }` | primary issue |
| GET | `/issues/duplicates` | admin | | `{ confirmed[], suggestions[] }` |
| GET | `/stats` | admin | | `{ counts (incl. `flagged`), byCategory, byDepartment, avgResolutionHours }` |
| GET | `/meta` | anyone | | enums |
| GET | `/health` | anyone | | server, DB and AI status |

### Socket.IO

- **Connect:** `io(URL, { auth: { token } })`.
- **Rooms:** every admin joins `admins`; each user joins `user:<id>`.
- **Events:** `issue:created` goes to admins and the reporter; `issue:updated` goes to admins and every student on the report. The payload is the same issue JSON the REST API returns.
- **`issue:flagged`** goes to `admins` only, as `{ issue, escalated }`, when a critical or high report arrives (or is raised to that level by students joining or a merge), and again as a reminder (`escalated: true`) while nobody has acknowledged it.

### Issue lifecycle

The normal path is `new → pending → assigned → in_progress → resolved`. A report closed by merging gets `duplicate` and points to the primary report through `duplicateOf`.

Assigning a `new` or `pending` report moves it to `assigned` automatically. Every change is added to the report's `timeline` with who made it and an optional note.

## Automatic extraction and dispatch

**What the AI reads from the description** (`src/ai/extract.js`, the same rules as `extract.py` in the AI service, which is used when it is connected):

| Field | Examples it understands |
|---|---|
| `location` | "Block B room 204" → `Block B · Room 204`, "ECE Lab 3", "boys hostel 2nd floor washroom", "the Dwarka route bus" |
| `occurredAt` + `whenText` | "since 10 minutes", "since morning", "yesterday", "at 9:30 am", "since Monday", "subah se", "kal se" |
| `recurring` | "keeps happening", "every day", "again", "roz" |
| `peopleCount`, `manyAffected` | "30 students", "the whole class", "everyone on the floor" |
| `missing` | the fields it could not find, e.g. `["location"]` |

The result is stored on the report as `extracted` (with `locationSource`: `ai`, `student` or `admin`) and written to the timeline. If no place is found the report is still sent, as "Not specified", and the student is asked for just the place; they can fix the place or type later with `PATCH /issues/:id/details`.

**Flag level** (`src/ai/dispatch.js`). Every report is dispatched; the level decides how loudly:

| Level | When | Admin must acknowledge within |
|---|---|---|
| `critical` | priority Critical, or severity 5, or safety risk ≥ 0.8 | 15 min (`ESCALATE_CRITICAL_MIN`) |
| `high` | priority High, or severity 4, or urgency 5, or safety risk ≥ 0.5 | 120 min (`ESCALATE_HIGH_MIN`) |
| `normal` | everything else | no deadline; it appears in the queue as usual |

The reasons ("safety risk 90%", "severity 5/5", …) are saved in `dispatch.reasons` and shown to admins. When students join a report or reports are merged, the level is recomputed and only ever raised.

**Acknowledging.** `POST /issues/:id/acknowledge` records who and when and moves a `new` report to `pending`. Any status change or assignment by an admin also counts as acknowledging.

**Reminders.** Once a minute the server re-alerts every critical/high report that is past its deadline and still unacknowledged (at most 6 reminders per report, one per deadline period) and notes it in the timeline.

**Chat channel (optional).** Set `ALERT_WEBHOOK_URL` to a Slack, Microsoft Teams or Discord incoming-webhook URL. Reports at or above `ALERT_WEBHOOK_LEVEL` (default `critical`) and their reminders are posted there with a link built from `APP_URL`. A failing webhook is logged and never blocks the report.

## AI triage and priority

`src/ai/index.js` is the single entry point.

- **Built-in engine (default):** `triage.js` uses keyword rules for type, severity, urgency and safety. Duplicate detection uses bag-of-words cosine similarity. It needs no extra setup and is fully explainable, so every score can be traced.
- **External model service (optional):** set `AI_SERVICE_URL` to plug in your trained models without touching the rest of the backend. The service must provide:

  ```
  POST /analyze  { description, category? }
       -> { category, confidence, severity (1-5), urgency (1-5), safetyImpact (0-1), signals?, alternatives?, model? }
  POST /embed    { text }  ->  { embedding: number[] }
  ```

  Embeddings are stored on each report and used for duplicate matching in place of word overlap. If the service is slow or down, the backend falls back to the built-in engine automatically.

**Priority score** (same formula the frontend displays):

```
score = 100 × (0.35·(severity−1)/4 + 0.25·(urgency−1)/4 + 0.25·safety + 0.15·min(1, log2(students affected)/5))
Critical ≥ 75 · High ≥ 55 · Medium ≥ 35 · Low < 35
```

**Duplicate similarity** = 75% text similarity, plus 0.15 if the place matches, plus 0.10 if the type matches. A score of 0.62 or more counts as "likely the same"; 0.40 or more counts as "possibly related".

## Security notes

- Passwords are hashed with bcrypt and never returned by the API.
- JWT secret: set a long random `JWT_SECRET`. The server refuses to start in production with the default secret.
- Students can only read or comment on reports they filed or joined. Every admin route is role-checked on the server, not just hidden in the UI.
- Uploads accept only JPG, PNG, WebP and GIF, at most 5 MB each and 3 per report. Photos from a rejected report are deleted.
- Set `ALLOWED_EMAIL_DOMAIN=bvcoe.edu.in` to restrict sign-ups to college emails.

## Deploying

- **Database:** MongoDB Atlas (free tier).
- **API:** Render, Railway or any Node host. Set the `.env` values as environment variables, with `NODE_ENV=production`. Uploaded photos go to local disk, so use a host with a persistent disk, or switch `middleware/upload.js` to Cloudinary/S3.
- **Frontend:** Vercel or Netlify. Set `VITE_API_URL` and `VITE_SOCKET_URL` to the API's public URL, and add the frontend's URL to the backend's `CLIENT_ORIGIN`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Failed to start: connect ECONNREFUSED 127.0.0.1:27017` | MongoDB isn't running, or `MONGO_URI` is wrong. With Atlas, add your IP to the access list. |
| Frontend says "Cannot reach the CampusCare server" | Backend not running, or `VITE_API_URL` points elsewhere. |
| Browser console shows a CORS error | Add the frontend's exact origin (e.g. `http://localhost:5173`) to `CLIENT_ORIGIN`. |
| Live updates don't arrive | Check `VITE_SOCKET_URL`, and that the "Live" dot in the sidebar is green. |
| Can't sign in with demo accounts | Run `npm run seed:reset`. |
| Old reports have no flag / "Read by the AI" card | They were created before this version. Run `npm run ai:backfill` (keeps your data), or stop the server and `npm run seed:reset` for fresh sample data. |
| No alarm sound for admins | Browsers only play sound after the page has been clicked once. Check the bell panel isn't set to "Sound off". |
| Webhook messages don't arrive | Check the server log for `alert webhook failed`, and that the report's level is at or above `ALERT_WEBHOOK_LEVEL`. |
