/**
 * In-browser mock of the CampusCare REST API + Socket.IO events.
 * - Data lives in localStorage so every open tab sees the same store.
 * - Events are broadcast to other tabs with BroadcastChannel, so a student
 *   submitting in one tab shows up live on the admin dashboard in another.
 * Every function returns the same JSON shape the real Express API is expected to return.
 */
import { buildSeed, USERS } from './seed.js';
import { analyze, computePriority, findSimilar, makeTitle, DUPLICATE_THRESHOLD } from '../lib/triage.js';
import { categoryById, departmentById, isOpen, STATUSES, CATEGORIES, DEPARTMENTS } from '../lib/constants.js';
import { extractDetails } from '../lib/extract.js';
import { DISPATCH_LEVELS, dispatchFor, rankOf } from '../lib/dispatch.js';

const KEY = 'campuscare.mockdb.v2'; // v2: reports carry dispatch + extracted details
const SESSION_KEY = 'campuscare.session';
const bus = new EventTarget();
let channel = null;
try { channel = new BroadcastChannel('campuscare'); } catch { /* not supported */ }

let db = null;
// Created lazily so importing this module in real-backend mode never touches storage.
const store = () => db || (db = load());

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage blocked */ }
  const fresh = buildSeed();
  persist(fresh);
  return fresh;
}

function persist(data = db) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota or blocked – keep in memory */ }
}

function emit(event, payload, { remote = true } = {}) {
  bus.dispatchEvent(new CustomEvent(event, { detail: payload }));
  if (remote && channel) channel.postMessage({ event, payload });
}

if (channel) {
  channel.onmessage = ({ data }) => {
    db = load(); // another tab changed the store
    emit(data.event, data.payload, { remote: false });
  };
}

/** Subscribe to mock socket events. Returns an unsubscribe function. */
export function onMockEvent(event, handler) {
  const fn = (e) => handler(e.detail);
  bus.addEventListener(event, fn);
  return () => bus.removeEventListener(event, fn);
}

const wait = (ms = 250 + Math.random() * 250) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));
const httpError = (status, message) => Object.assign(new Error(message), { status });

function currentUser() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY))?.user || null; } catch { return null; }
}
function requireUser(role) {
  const u = currentUser();
  if (!u) throw httpError(401, 'Please sign in again.');
  if (role && u.role !== role) throw httpError(403, 'You do not have access to this action.');
  return u;
}
function find(id) {
  const issue = store().issues.find((i) => i.id === id || i.ticket === id);
  if (!issue) throw httpError(404, 'That report does not exist or was removed.');
  return issue;
}
function touch(issue, status, by, note) {
  const at = new Date().toISOString();
  if (status) issue.status = status;
  issue.updatedAt = at;
  issue.timeline.push({ status: issue.status, at, by, note });
}
function rescore(issue) {
  issue.priority = computePriority({ ...issue.ai, affectedCount: issue.affectedCount });
}
const AI = 'CampusCare AI';
const FLAGGED = ['critical', 'high'];
function markAcknowledged(issue, u) {
  if (!issue.dispatch || issue.dispatch.acknowledgedAt) return false;
  issue.dispatch.acknowledgedAt = new Date().toISOString();
  issue.dispatch.acknowledgedBy = u.name;
  return true;
}
function announce(issue, escalated = false) {
  if (FLAGGED.includes(issue.dispatch?.level)) emit('issue:flagged', clone({ issue, escalated }));
}
function upgradeDispatch(issue) {
  const next = dispatchFor(issue.ai, issue.priority);
  if (issue.dispatch && rankOf(next.level) <= rankOf(issue.dispatch.level)) return false;
  issue.dispatch = { ...issue.dispatch, level: next.level, reasons: next.reasons, acknowledgedAt: null, acknowledgedBy: null };
  touch(issue, null, AI, `Raised to ${DISPATCH_LEVELS[next.level].label}: ${next.reasons.join(', ')}. Administrators alerted.`);
  return true;
}
function dispatchNote({ level, reasons }) {
  return level === 'normal'
    ? `Sent to administrators automatically (${reasons.join(', ')}).`
    : `Flagged ${DISPATCH_LEVELS[level].label} and sent to administrators for immediate attention: ${reasons.join(', ')}.`;
}
function extractionNote(ex, given) {
  const parts = [given ? 'place given by the student' : ex.location ? `place "${ex.location}"` : 'no place mentioned, the student was asked to add it'];
  if (ex.whenText) parts.push(`noticed "${ex.whenText}"`);
  if (ex.peopleCount) parts.push(`about ${ex.peopleCount} people affected`);
  else if (ex.manyAffected) parts.push('many students affected');
  return `Details read from the description: ${parts.join('; ')}.`;
}
/** Builds a new report exactly like the backend's createIssue: AI triage + extracted details + dispatch. */
function buildIssue({ description, category, location, occurredAt, images = [] }, u) {
  const text = description.trim();
  const ai = analyze(text, category);
  const ex = extractDetails(text);
  const given = (location || '').trim();
  const place = given || ex.location || 'Not specified';
  const priority = computePriority({ ...ai, affectedCount: 1 });
  const n = store().nextNumber++;
  const now = new Date().toISOString();
  const dispatch = { ...dispatchFor(ai, priority), sentAt: now, acknowledgedAt: null, acknowledgedBy: null, escalatedAt: null, escalations: 0 };
  const department = categoryById(ai.category).department;
  const duplicates = findSimilar({ description: text, category: ai.category, location: place }, store().issues.filter((i) => isOpen(i.status)), { limit: 3 })
    .filter((s) => s.similarity >= DUPLICATE_THRESHOLD);
  const issue = {
    id: `iss-${n}`,
    ticket: `CC-26-${String(n).padStart(4, '0')}`,
    title: makeTitle(text),
    description: text,
    category: ai.category,
    location: place,
    occurredAt: occurredAt || ex.occurredAt || now,
    createdAt: now,
    updatedAt: now,
    images,
    status: 'new',
    department,
    assignee: null,
    reporter: { id: u.id, name: u.name },
    affectedUsers: [u.id],
    affectedCount: 1,
    ai,
    priority,
    dispatch,
    extracted: { ...ex, missing: place === 'Not specified' ? ['location'] : [], locationSource: given ? 'student' : ex.location ? 'ai' : 'none' },
    duplicateOf: null,
    comments: [],
    timeline: [
      { status: 'new', at: now, by: AI, note: `Classified as ${categoryById(ai.category).label} (${Math.round(ai.confidence * 100)}%), routed to ${departmentById(department).name}. ${extractionNote(ex, Boolean(given))}` },
      { status: 'new', at: now, by: AI, note: dispatchNote(dispatch) },
      ...duplicates.slice(0, 1).map((d) => ({ status: 'new', at: now, by: AI, note: `Looks like ${d.issue.ticket} (${Math.round(d.similarity * 100)}% match). An administrator will review whether to merge.` })),
    ],
  };
  const summaryOf = (i) => ({ id: i.id, ticket: i.ticket, title: i.title, location: i.location, status: i.status, affectedCount: i.affectedCount, createdAt: i.createdAt });
  return { issue, possibleDuplicates: duplicates.map((d) => ({ ...summaryOf(d.issue), similarity: d.similarity })) };
}

// ------------------------------------------------------------------ auth
export async function login({ email, password, role }) {
  await wait();
  if (!email || !password) throw httpError(400, 'Enter your college email and password.');
  let user = USERS.find((u) => u.email.toLowerCase() === email.toLowerCase().trim());
  if (!user) {
    // Any other college address signs in as a new demo account with the chosen role.
    const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    user = { id: `u-${Date.now()}`, name, email, role: role || 'student' };
  }
  if (role && user.role !== role) throw httpError(403, `${email} is registered as ${user.role === 'admin' ? 'an administrator' : 'a student'}. Switch the role above.`);
  return { token: `mock.${user.id}`, user };
}

export async function register({ name, email, password, enrollment, branch }) {
  await wait();
  if (!name || name.trim().length < 2) throw httpError(400, 'Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw httpError(400, 'Enter a valid email address.');
  if (!password || password.length < 8) throw httpError(400, 'Use a password of at least 8 characters.');
  if (USERS.some((u) => u.email === email.toLowerCase().trim())) throw httpError(409, 'An account with this email already exists.');
  const user = { id: `u-${Date.now()}`, name: name.trim(), email: email.toLowerCase().trim(), role: 'student', enrollment, branch };
  return { token: `mock.${user.id}`, user };
}

export async function me() {
  await wait(80);
  return requireUser();
}

// ------------------------------------------------------------------ issues
function matches(issue, q) {
  if (q.status === 'open' && !isOpen(issue.status)) return false;
  if (q.status === 'high' && !(isOpen(issue.status) && ['critical', 'high'].includes(issue.priority.level))) return false;
  if (q.status === 'flagged' && !(isOpen(issue.status) && FLAGGED.includes(issue.dispatch?.level))) return false;
  if (q.status === 'todo' && !['new', 'pending'].includes(issue.status)) return false;
  if (q.status === 'team' && !['assigned', 'in_progress'].includes(issue.status)) return false;
  if (q.status && !['open', 'high', 'flagged', 'todo', 'team', 'all'].includes(q.status) && issue.status !== q.status) return false;
  if (q.category && issue.category !== q.category) return false;
  if (q.department && issue.department !== q.department) return false;
  if (q.level && issue.priority.level !== q.level) return false;
  if (q.search) {
    const s = q.search.toLowerCase();
    if (![issue.title, issue.description, issue.location, issue.ticket].some((f) => f.toLowerCase().includes(s))) return false;
  }
  return true;
}

export async function listIssues(query = {}) {
  await wait();
  requireUser('admin');
  const items = store().issues.filter((i) => matches(i, query));
  const sort = query.sort || 'priority';
  items.sort((a, b) =>
    sort === 'newest' ? b.createdAt.localeCompare(a.createdAt)
      : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt)
      : (isOpen(b.status) - isOpen(a.status)) || b.priority.score - a.priority.score
  );
  return { items: clone(items), total: items.length };
}

export async function myIssues() {
  await wait();
  const u = requireUser();
  const items = store().issues
    .filter((i) => i.reporter.id === u.id || i.affectedUsers.includes(u.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items: clone(items) };
}

export async function getIssue(id) {
  await wait(150);
  const u = requireUser();
  const issue = find(id);
  if (u.role === 'student' && issue.reporter.id !== u.id && !issue.affectedUsers.includes(u.id)) {
    throw httpError(403, 'You can only open reports you submitted or joined.');
  }
  const parent = issue.duplicateOf ? store().issues.find((i) => i.id === issue.duplicateOf) : null;
  const merged = store().issues.filter((i) => i.duplicateOf === issue.id);
  const related = findSimilar(issue, store().issues.filter((i) => i.id !== issue.id && i.duplicateOf !== issue.id && i.id !== issue.duplicateOf), { exclude: issue.id, limit: 3 });
  return clone({
    ...issue,
    parent: parent && { id: parent.id, ticket: parent.ticket, title: parent.title, status: parent.status },
    merged: merged.map((m) => ({ id: m.id, ticket: m.ticket, title: m.title, reporter: m.reporter, createdAt: m.createdAt })),
    related: related.map((r) => ({ id: r.issue.id, ticket: r.issue.ticket, title: r.issue.title, status: r.issue.status, location: r.issue.location, similarity: r.similarity })),
  });
}

/** Runs AI triage on a draft before it is submitted (POST /issues/analyze). */
export async function analyzeDraft({ description, category, location }) {
  await wait(700);
  const ai = analyze(description, category);
  const extracted = extractDetails(description);
  const similar = findSimilar({ description, category: ai.category, location: location || extracted.location }, store().issues.filter((i) => isOpen(i.status)), { limit: 3 });
  const priority = computePriority({ ...ai, affectedCount: 1 });
  return clone({
    ai,
    priority,
    department: categoryById(ai.category).department,
    extracted,
    dispatch: dispatchFor(ai, priority),
    similar: similar.map((s) => ({
      similarity: s.similarity,
      likelyDuplicate: s.similarity >= DUPLICATE_THRESHOLD,
      issue: { id: s.issue.id, ticket: s.issue.ticket, title: s.issue.title, location: s.issue.location, status: s.issue.status, affectedCount: s.issue.affectedCount, createdAt: s.issue.createdAt },
    })),
  });
}

export async function createIssue(body) {
  await wait(600);
  const u = requireUser();
  if (!body.description || body.description.trim().length < 10) throw httpError(400, 'Describe the problem in at least a few words.');
  const { issue, possibleDuplicates } = buildIssue(body, u);
  store().issues.unshift(issue);
  persist();
  emit('issue:created', clone(issue));
  announce(issue);
  return clone({ ...issue, possibleDuplicates });
}

/** Admin acknowledges a flagged report: the alert clears and a New report moves to Pending. */
export async function acknowledgeIssue(id, { note } = {}) {
  await wait(200);
  const u = requireUser('admin');
  const issue = find(id);
  if (!isOpen(issue.status)) throw httpError(409, 'This report is already closed.');
  const cleared = markAcknowledged(issue, u);
  if (issue.status === 'new') touch(issue, 'pending', u.name, note || 'Acknowledged by the administration.');
  else if (cleared) touch(issue, null, u.name, note || 'Alert acknowledged.');
  else return clone(issue);
  persist();
  emit('issue:updated', clone(issue));
  return clone(issue);
}

/** The reporter (or an admin) corrects what the AI read: place or issue type. */
export async function updateDetails(id, { location, category } = {}) {
  await wait(250);
  const u = requireUser();
  const issue = find(id);
  if (u.role !== 'admin' && issue.reporter.id !== u.id) throw httpError(403, 'Only the student who filed this report can change its details.');
  if (!isOpen(issue.status)) throw httpError(409, 'This report is closed, so its details can no longer change.');
  const changes = [];
  const place = (location || '').trim().slice(0, 160);
  if (place && place !== issue.location) {
    issue.location = place;
    issue.extracted = { ...(issue.extracted || {}), locationSource: u.role === 'admin' ? 'admin' : 'student', missing: [] };
    changes.push(`place set to "${place}"`);
  }
  if (category && category !== issue.category) {
    issue.category = category;
    issue.department = categoryById(category).department;
    changes.push(`type changed to ${categoryById(category).label}, routed to ${departmentById(issue.department).name}`);
  }
  if (!changes.length) throw httpError(400, 'Nothing to change.');
  touch(issue, null, u.name, `Details corrected: ${changes.join('; ')}.`);
  persist();
  emit('issue:updated', clone(issue));
  return clone(issue);
}

/** Flagged reports nobody has acknowledged yet, most severe first (admin alert bell). */
export async function listAlerts() {
  await wait(120);
  requireUser('admin');
  const items = store().issues
    .filter((i) => FLAGGED.includes(i.dispatch?.level) && !i.dispatch.acknowledgedAt && isOpen(i.status))
    .sort((a, b) => rankOf(b.dispatch.level) - rankOf(a.dispatch.level) || b.createdAt.localeCompare(a.createdAt));
  return clone({ items, counts: { critical: items.filter((i) => i.dispatch.level === 'critical').length, high: items.filter((i) => i.dispatch.level === 'high').length } });
}

/** "Me too" – the student is affected by an existing report instead of filing a duplicate. */
export async function joinIssue(id) {
  await wait();
  const u = requireUser();
  const issue = find(id);
  if (!issue.affectedUsers.includes(u.id)) {
    issue.affectedUsers.push(u.id);
    issue.affectedCount += 1;
    rescore(issue);
    touch(issue, null, 'CampusCare AI', `${u.name} reported the same problem. ${issue.affectedCount} students affected, priority now ${issue.priority.score}.`);
    const raised = upgradeDispatch(issue);
    persist();
    emit('issue:updated', clone(issue));
    if (raised) announce(issue);
  }
  return clone(issue);
}

export async function updateStatus(id, { status, note }) {
  await wait();
  const u = requireUser('admin');
  const issue = find(id);
  if (!STATUSES.some((s) => s.id === status)) throw httpError(400, 'Unknown status.');
  markAcknowledged(issue, u);
  touch(issue, status, u.name, note || null);
  persist();
  emit('issue:updated', clone(issue));
  return clone(issue);
}

export async function assignIssue(id, { department, assignee, note }) {
  await wait();
  const u = requireUser('admin');
  const issue = find(id);
  if (!isOpen(issue.status)) throw httpError(409, 'This report is closed. Reopen it first.');
  const person = assignee ? String(assignee).trim().slice(0, 80) : null;
  const changedDept = department && department !== issue.department;
  const changedPerson = person && person !== issue.assignee;
  const moveForward = ['new', 'pending'].includes(issue.status) ? 'assigned' : null;
  if (!moveForward && !changedDept && !changedPerson) throw httpError(400, 'Nothing to change.');
  issue.department = department || issue.department;
  issue.assignee = person || issue.assignee;
  markAcknowledged(issue, u);
  const text = note ? String(note).trim().slice(0, 500) : '';
  const what = moveForward ? 'Assigned to' : changedDept ? 'Re-routed to' : 'Assigned within';
  touch(issue, moveForward, u.name,
    `${what} ${departmentById(issue.department).name}${issue.assignee ? ` · ${issue.assignee}` : ''}.${text ? ` ${text}` : ''}`);
  persist();
  emit('issue:updated', clone(issue));
  return clone(issue);
}

export async function addComment(id, { text }) {
  await wait(200);
  const u = requireUser();
  const issue = find(id);
  if (!text?.trim()) throw httpError(400, 'Write a comment first.');
  issue.comments.push({ id: `c${Date.now()}`, author: u.name, role: u.role, text: text.trim(), at: new Date().toISOString() });
  issue.updatedAt = new Date().toISOString();
  persist();
  emit('issue:updated', clone(issue));
  return clone(issue);
}

/** Merge a report into another one (admin confirms an AI duplicate suggestion). */
export async function mergeIssue(id, { into }) {
  await wait();
  const u = requireUser('admin');
  const dup = find(id);
  const primary = find(into);
  dup.duplicateOf = primary.id;
  touch(dup, 'duplicate', u.name, `Merged into ${primary.ticket}.`);
  dup.affectedUsers.forEach((uid) => { if (!primary.affectedUsers.includes(uid)) primary.affectedUsers.push(uid); });
  primary.affectedCount += dup.affectedCount;
  rescore(primary);
  touch(primary, null, u.name, `${dup.ticket} merged in. ${primary.affectedCount} students affected, priority now ${primary.priority.score}.`);
  markAcknowledged(dup, u);
  const raised = upgradeDispatch(primary);
  persist();
  emit('issue:updated', clone(dup));
  emit('issue:updated', clone(primary));
  if (raised) announce(primary);
  return clone(primary);
}

/** Groups for the duplicates screen: confirmed merges and AI suggestions awaiting review. */
export async function duplicateGroups() {
  await wait();
  requireUser('admin');
  const confirmed = store().issues
    .filter((p) => store().issues.some((i) => i.duplicateOf === p.id))
    .map((p) => ({ primary: p, members: store().issues.filter((i) => i.duplicateOf === p.id) }));

  const open = store().issues.filter((i) => isOpen(i.status));
  const seen = new Set();
  const suggestions = [];
  open.forEach((a) => {
    findSimilar(a, open, { exclude: a.id, limit: 3 }).forEach(({ issue: b, similarity }) => {
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      const [primary, candidate] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
      suggestions.push({ primary, candidate, similarity });
    });
  });
  suggestions.sort((x, y) => y.similarity - x.similarity);
  return clone({ confirmed, suggestions });
}

export async function stats() {
  await wait(150);
  requireUser('admin');
  const all = store().issues;
  const open = all.filter((i) => isOpen(i.status));
  const weekAgo = Date.now() - 7 * 864e5;
  const count = (f) => all.filter(f).length;
  return {
    counts: {
      new: count((i) => i.status === 'new'),
      pending: count((i) => i.status === 'pending'),
      high: open.filter((i) => ['critical', 'high'].includes(i.priority.level)).length,
      assigned: count((i) => ['assigned', 'in_progress'].includes(i.status)),
      resolved: count((i) => i.status === 'resolved' && new Date(i.updatedAt).getTime() > weekAgo),
      duplicates: count((i) => i.status === 'duplicate'),
      flagged: open.filter((i) => FLAGGED.includes(i.dispatch?.level) && !i.dispatch.acknowledgedAt).length,
    },
    byCategory: CATEGORIES.map((c) => ({ id: c.id, label: c.label, open: open.filter((i) => i.category === c.id).length })).filter((x) => x.open),
    byDepartment: Object.values(DEPARTMENTS).map((d) => ({
      id: d.id, label: d.short,
      open: open.filter((i) => i.department === d.id).length,
      critical: open.filter((i) => i.department === d.id && ['critical', 'high'].includes(i.priority.level)).length,
    })).filter((x) => x.open),
    avgResolutionHours: (() => {
      const done = all.filter((i) => i.status === 'resolved');
      if (!done.length) return null;
      const h = done.reduce((s, i) => s + (new Date(i.updatedAt) - new Date(i.createdAt)) / 36e5, 0) / done.length;
      return Math.round(h);
    })(),
  };
}

// ------------------------------------------------------------------ demo helpers
// Demo reports written the way students type: the AI has to find the place and time itself.
const DEMO_REPORTS = [
  { text: 'Smoke coming from the electrical panel near the Block B staircase since 10 minutes, smells like burning plastic.' },
  { text: 'Water tank on the boys hostel terrace is overflowing since morning, water is flooding everywhere.' },
  { text: 'Wifi in ECE Lab 3 keeps disconnecting during the practical exam, whole class affected.' },
  { text: 'Tube light in Block A room 210 is flickering since yesterday, hard to read the board.' },
  { text: 'Someone stole two bicycles from the cycle stand last night, the guard was not at the gate.' },
  { text: 'The paint on the walls of the seminar hall is peeling off.' },
];

/** Admin-only demo button: inject a report as if a student had just typed and sent it. */
export async function simulateIncoming() {
  const pick = DEMO_REPORTS[Math.floor(Math.random() * DEMO_REPORTS.length)];
  const student = USERS[1 + Math.floor(Math.random() * 3)];
  const { issue } = buildIssue({ description: pick.text }, student);
  store().issues.unshift(issue);
  persist();
  emit('issue:created', clone(issue));
  announce(issue);
  return clone(issue);
}

export function resetDemoData() {
  db = buildSeed();
  persist();
  emit('issue:reset', null);
}

export { SESSION_KEY };
