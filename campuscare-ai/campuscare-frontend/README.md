# CampusCare AI – Frontend

React frontend for **CampusCare AI: An Intelligent Real-Time Campus Issue Reporting and Prioritization System**
(Minor Project, Dept. of ECE, BVCOE New Delhi – Sanju, Deepanshu, Aadarsh Jha; guide Dr. Yugnanda).

Stack: React 18 · React Router 6 · Axios · Socket.IO client · Vite. No UI library; all styling is in `src/styles/global.css` (light + dark theme).

## Run it

```bash
npm install
cp .env.example .env      # VITE_USE_MOCK=true by default
npm run dev               # http://localhost:5173
```

With `VITE_USE_MOCK=true` the app runs **without a backend**: a mock server in the browser (`src/api/mockServer.js`) holds seeded demo data, runs a simplified AI triage and fakes Socket.IO events. Open a student tab and an admin tab side by side: a report submitted as the student pops up live on the admin board (tabs share data through `localStorage` + `BroadcastChannel`).

Students can create an account from the login screen ("Create a student account").

Demo logins (any password in demo mode; `demo1234` against the real backend):

| Role | Email |
|---|---|
| Student | `student@bvcoe.edu.in` |
| Administrator | `admin@bvcoe.edu.in` |

## Screens

**Student**
- **Report an issue** (`/student/report`) – one step. The student describes the problem in their own words (and can attach up to 3 photos with the camera button) and presses **Send**. The AI reads the place, the time it was noticed, whether it keeps happening and how many people are affected straight from the text, scores severity, and **sends the report to the administration automatically**: critical and high reports are flagged so admins are alerted at once. No follow-up form. Only if no place can be found does the chat ask one question ("where is it?"). A side panel shows, while the student types, what the AI has understood and how the report will be sent.
- **My reports** (`/student/reports`) – open / resolved tabs, updates live.
- **Report detail** – how it was sent (flag level, acknowledged or not), "Read by the AI" card where the student can correct the place or type, status timeline, AI triage, messages with staff.

**Administrator**
- **Alerts** – a bell in the side rail with the number of flagged reports waiting, a red banner on every admin page while a critical report is unacknowledged, a short alarm sound (mute in the bell panel) and optional desktop notifications. *Acknowledge* clears the alert and moves the report to Pending; any status change or assignment also counts.
- **Triage board** (`/admin`) – "Needs attention now" list of flagged reports, counts (flagged by AI, new, pending, high-priority, with a team, resolved), open reports ranked by priority with one-click next step (Acknowledge → Assign → Start work → Resolve), open load by department and type, live activity feed, toast for every incoming report.
- **All issues** (`/admin/issues`) – filter by status (including *Flagged by AI*), priority, type, department, search; sort by priority/newest/oldest. Filters live in the URL so dashboard tiles link straight to a filtered list.
- **Issue detail** – dispatch card with why the AI flagged it and an Acknowledge button, details the AI read from the description, change status with a note to the student, re-route to another department, assign a person, see the priority breakdown, merge into a similar report.
- **Duplicates** (`/admin/duplicates`) – AI-suggested pairs with match %, merge or dismiss; list of merged groups.

## Priority score (0–100)

Shown and explained on every report (`src/lib/triage.js → computePriority`):

```
score = 100 × ( 0.35·severity' + 0.25·urgency' + 0.25·safety + 0.15·reach )
severity', urgency' = (x − 1) / 4        (model outputs 1–5)
safety              = 0–1 safety-impact estimate
reach               = min(1, log2(students affected) / 5)    → 1 at 32+ students
bands: Critical ≥ 75 · High ≥ 55 · Medium ≥ 35 · Low
```

Joining or merging a report increases "students affected", so its priority rises automatically.

> The mock uses keyword rules and bag-of-words cosine similarity so the UI can be demoed. In the real system the backend should return the same fields from the BERT/LLM classifier and sentence-embedding similarity described in the literature survey.

## Connecting the Node/Express backend

The matching backend is in `../campuscare-backend` (see its README to install, seed and run it). Then set in `.env`:

```
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:8000/api
VITE_SOCKET_URL=http://localhost:8000
```

The full REST contract is documented at the top of `src/api/index.js`. Summary:

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password, role }` | `{ token, user }` |
| POST | `/auth/register` | `{ name, email, password, enrollment?, branch? }` | `{ token, user }` |
| GET | `/auth/me` | | `user` |
| GET | `/issues` | `status, category, department, level, search, sort` | `{ items, total }` |
| GET | `/issues/mine` | | `{ items }` |
| GET | `/issues/:id` | | issue + `parent`, `merged[]`, `related[]` |
| POST | `/issues/analyze` | `{ description, category?, location? }` | `{ ai, priority, department, similar[], extracted, dispatch }` |
| POST | `/issues` | multipart: `description`, `images[]` (everything else optional; the AI fills it) | issue + `possibleDuplicates[]` |
| PATCH | `/issues/:id/details` | `{ location?, category? }` (reporter or admin) | issue |
| GET | `/issues/alerts` | (admin) | `{ items, counts: { critical, high } }` |
| POST | `/issues/:id/acknowledge` | (admin) | issue |
| POST | `/issues/:id/join` | | issue |
| PATCH | `/issues/:id/status` | `{ status, note }` | issue |
| PATCH | `/issues/:id/assign` | `{ department, assignee }` | issue |
| POST | `/issues/:id/comments` | `{ text }` | issue |
| POST | `/issues/:id/merge` | `{ into }` | primary issue |
| GET | `/issues/duplicates` | | `{ confirmed[], suggestions[] }` |
| GET | `/stats` | | dashboard counts |

Auth: JWT sent as `Authorization: Bearer <token>`; a 401 signs the user out.

Socket.IO: the client connects with `auth: { token }` and listens for `issue:created` and `issue:updated` (payload = the full issue), and admins also get `issue:flagged` (`{ issue, escalated }`) for critical/high reports and for reminders when one is not acknowledged in time. Suggested rooms on the server: `admins` for all admins, `user:<id>` for each student.

The shape of an issue object is easiest to read in `src/api/mockServer.js → createIssue`. Enum values (categories, departments, statuses, priority levels) are in `src/lib/constants.js`; keep the backend enums identical.

## Folder structure

```
src/
  api/          index.js (API surface), http.js (axios + JWT), mockServer.js, seed.js
  realtime/     RealtimeContext.jsx (Socket.IO / mock events, useRealtimeEvent hook)
  context/      AuthContext.jsx, ToastContext.jsx, AlertsContext.jsx (admin alerts, alarm, notifications)
  lib/          constants.js (enums, DISPATCH), triage.js (mock AI + priority formula), extract.js + dispatch.js
                (same rules as the backend: details from text, flag level), format.js
  components/   Layout, Alerts (bell, banner), IssueRow, PriorityBreakdown, Timeline, Icon, ui (badges, bars…)
  pages/        Login, IssueDetail, NotFound
    student/    ReportChat, MyReports
    admin/      Dashboard, IssueQueue, Duplicates
  styles/       global.css
```

`VITE_ROUTER_MODE=hash` switches to `#/` URLs for static hosting without server rewrites.
