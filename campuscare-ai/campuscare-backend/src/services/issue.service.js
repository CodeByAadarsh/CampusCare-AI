/**
 * Business logic for reports ("issues"). Routes stay thin and call these functions.
 * Every function returns plain JSON in exactly the shape the React frontend expects
 * (see campuscare-frontend/src/api/index.js and mockServer.js).
 */
import mongoose from 'mongoose';
import { Issue } from '../models/Issue.js';
import { nextSequence } from '../models/Counter.js';
import { CATEGORIES, DEPARTMENTS, STATUSES, categoryById, departmentById, isOpen } from '../constants.js';
import { analyzeReport, embedText, computePriority, findSimilar, makeTitle, DUPLICATE_THRESHOLD } from '../ai/index.js';
import { DISPATCH_LEVELS, dispatchFor, rankOf } from '../ai/dispatch.js';
import { emitIssue, emitAdmins } from '../realtime/socket.js';
import { sendWebhook } from './alerts.js';
import { config } from '../config.js';
import { httpError, escapeRegex } from '../utils/http.js';

const OPEN_STATUSES = STATUSES.filter((s) => s.open).map((s) => s.id);
const AI_ACTOR = 'CampusCare AI';
const FLAGGED = ['critical', 'high'];
const iso = (d) => (d ? new Date(d).toISOString() : null);

// ------------------------------------------------------------------ serialisation
/** Mongoose document or lean object -> API JSON. */
export function serializeIssue(doc, { keepEmbedding = false } = {}) {
  const d = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const ai = d.ai || {};
  const out = {
    id: String(d._id),
    ticket: d.ticket,
    title: d.title,
    description: d.description,
    category: d.category,
    location: d.location,
    occurredAt: iso(d.occurredAt),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
    images: d.images || [],
    status: d.status,
    department: d.department,
    assignee: d.assignee ?? null,
    reporter: { id: String(d.reporter?.id), name: d.reporter?.name },
    affectedUsers: (d.affectedUsers || []).map(String),
    affectedCount: d.affectedCount,
    ai: {
      category: ai.category,
      confidence: ai.confidence,
      suggestedCategory: ai.suggestedCategory,
      alternatives: (ai.alternatives || []).map((a) => ({ category: a.category, confidence: a.confidence })),
      severity: ai.severity,
      urgency: ai.urgency,
      safetyImpact: ai.safetyImpact,
      signals: ai.signals || [],
      model: ai.model,
    },
    priority: {
      score: d.priority?.score ?? 0,
      level: d.priority?.level ?? 'low',
      breakdown: (d.priority?.breakdown || []).map((b) => ({ key: b.key, label: b.label, weight: b.weight, value: b.value, raw: b.raw, points: b.points })),
    },
    dispatch: d.dispatch ? {
      level: d.dispatch.level,
      reasons: d.dispatch.reasons || [],
      sentAt: iso(d.dispatch.sentAt),
      acknowledgedAt: iso(d.dispatch.acknowledgedAt),
      acknowledgedBy: d.dispatch.acknowledgedBy ?? null,
      escalatedAt: iso(d.dispatch.escalatedAt),
      escalations: d.dispatch.escalations || 0,
    } : null,
    extracted: d.extracted ? {
      location: d.extracted.location ?? null,
      locationSource: d.extracted.locationSource || 'none',
      occurredAt: iso(d.extracted.occurredAt),
      whenText: d.extracted.whenText ?? null,
      recurring: Boolean(d.extracted.recurring),
      peopleCount: d.extracted.peopleCount ?? null,
      manyAffected: Boolean(d.extracted.manyAffected),
      missing: d.extracted.missing || [],
    } : null,
    duplicateOf: d.duplicateOf ? String(d.duplicateOf) : null,
    comments: (d.comments || []).map((c) => ({ id: String(c._id), author: c.author, role: c.role, text: c.text, at: iso(c.at) })),
    timeline: (d.timeline || []).map((t) => ({ status: t.status, at: iso(t.at), by: t.by, note: t.note ?? null })),
  };
  if (keepEmbedding && d.embedding?.length) out.embedding = d.embedding;
  return out;
}

const summary = (i) => ({ id: i.id, ticket: i.ticket, title: i.title, location: i.location, status: i.status, affectedCount: i.affectedCount, createdAt: i.createdAt });

// ------------------------------------------------------------------ helpers
const sameId = (a, b) => String(a) === String(b);
const isInvolved = (user, issue) =>
  sameId(issue.reporter.id, user._id) || (issue.affectedUsers || []).some((u) => sameId(u, user._id));

async function findIssueDoc(idOrTicket) {
  const doc = mongoose.isValidObjectId(idOrTicket)
    ? await Issue.findById(idOrTicket)
    : await Issue.findOne({ ticket: String(idOrTicket).toUpperCase() });
  if (!doc) throw httpError(404, 'That report does not exist or was removed.');
  return doc;
}

function addTimeline(doc, status, by, note = null) {
  if (status) doc.status = status;
  doc.timeline.push({ status: doc.status, at: new Date(), by, note });
}

function rescore(doc) {
  doc.priority = computePriority({
    severity: doc.ai.severity,
    urgency: doc.ai.urgency,
    safetyImpact: doc.ai.safetyImpact,
    affectedCount: doc.affectedCount,
  });
}

async function saveAndEmit(doc, event = 'issue:updated') {
  await doc.save();
  const json = serializeIssue(doc);
  emitIssue(event, json);
  return json;
}

const plain = (sub) => (sub && typeof sub.toObject === 'function' ? sub.toObject() : sub || {});

/** Any admin action on a flagged report counts as acknowledging its alert. */
function markAcknowledged(doc, user) {
  if (!doc.dispatch || doc.dispatch.acknowledgedAt) return false;
  doc.dispatch.acknowledgedAt = new Date();
  doc.dispatch.acknowledgedBy = user.name;
  return true;
}

/** Real-time alert to admin screens (critical/high) and the optional webhook. Never throws. */
function announce(json, { escalated = false } = {}) {
  if (FLAGGED.includes(json.dispatch?.level)) emitAdmins('issue:flagged', { issue: json, escalated });
  sendWebhook(json, { escalated }).catch(() => {});
}

function dispatchNote({ level, reasons }) {
  return level === 'normal'
    ? `Sent to administrators automatically (${reasons.join(', ')}).`
    : `Flagged ${DISPATCH_LEVELS[level].label} and sent to administrators for immediate attention: ${reasons.join(', ')}.`;
}

function extractionNote(ex, locationFromStudent) {
  const parts = [];
  if (locationFromStudent) parts.push('place given by the student');
  else if (ex.location) parts.push(`place "${ex.location}"`);
  else parts.push('no place mentioned, the student was asked to add it');
  if (ex.whenText) parts.push(`noticed "${ex.whenText}"`);
  if (ex.peopleCount) parts.push(`about ${ex.peopleCount} people affected`);
  else if (ex.manyAffected) parts.push('many students affected');
  return `Details read from the description: ${parts.join('; ')}.`;
}

/** After a join or merge raises the priority, the flag may need to go up too. */
function upgradeDispatch(doc) {
  const next = dispatchFor(doc.ai, doc.priority);
  if (doc.dispatch && rankOf(next.level) <= rankOf(doc.dispatch.level)) return false;
  doc.dispatch = { ...plain(doc.dispatch), level: next.level, reasons: next.reasons, sentAt: doc.dispatch?.sentAt || new Date(), acknowledgedAt: null, acknowledgedBy: null };
  addTimeline(doc, null, AI_ACTOR, `Raised to ${DISPATCH_LEVELS[next.level].label}: ${next.reasons.join(', ')}. Administrators alerted.`);
  return true;
}

async function openCandidates(excludeIds = []) {
  const docs = await Issue.find({ status: { $in: OPEN_STATUSES } }).lean();
  return docs.map((d) => serializeIssue(d, { keepEmbedding: true })).filter((i) => !excludeIds.includes(i.id));
}

const stripEmbedding = ({ embedding, ...rest }) => rest; // eslint-disable-line no-unused-vars

// ------------------------------------------------------------------ queries
/** GET /issues (admin). Filters mirror the frontend's All issues screen. */
export async function listIssues(q = {}) {
  const filter = {};
  const status = q.status || 'open';
  if (status === 'open') filter.status = { $in: OPEN_STATUSES };
  else if (status === 'high') { filter.status = { $in: OPEN_STATUSES }; filter['priority.level'] = { $in: ['critical', 'high'] }; }
  else if (status === 'flagged') { filter.status = { $in: OPEN_STATUSES }; filter['dispatch.level'] = { $in: FLAGGED }; }
  else if (status === 'todo') filter.status = { $in: ['new', 'pending'] };          // not handed to a team yet
  else if (status === 'team') filter.status = { $in: ['assigned', 'in_progress'] }; // with a team
  else if (status !== 'all') filter.status = status;
  if (q.category) filter.category = q.category;
  if (q.department) filter.department = q.department;
  if (q.level) filter['priority.level'] = q.level;
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).trim()), 'i');
    filter.$or = [{ title: rx }, { description: rx }, { location: rx }, { ticket: rx }];
  }

  const items = (await Issue.find(filter).select('-embedding').lean()).map((d) => serializeIssue(d));
  const sort = q.sort || 'priority';
  items.sort((a, b) =>
    sort === 'newest' ? b.createdAt.localeCompare(a.createdAt)
      : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt)
      : (isOpen(b.status) - isOpen(a.status)) || b.priority.score - a.priority.score
  );
  return { items, total: items.length };
}

/** GET /issues/mine – reports the student filed or joined. */
export async function myIssues(user) {
  const docs = await Issue.find({ $or: [{ 'reporter.id': user._id }, { affectedUsers: user._id }] }).select('-embedding').lean();
  const items = docs.map((d) => serializeIssue(d)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items };
}

/** GET /issues/:id – one report plus its parent, merged children and similar reports. */
export async function getIssueDetail(user, id) {
  const doc = await findIssueDoc(id);
  const issue = serializeIssue(doc, { keepEmbedding: true });
  if (user.role !== 'admin' && !isInvolved(user, issue)) {
    throw httpError(403, 'You can only open reports you submitted or joined.');
  }

  const [parentDoc, mergedDocs, others] = await Promise.all([
    issue.duplicateOf ? Issue.findById(issue.duplicateOf).select('ticket title status').lean() : null,
    Issue.find({ duplicateOf: doc._id }).select('ticket title reporter createdAt').lean(),
    Issue.find({ _id: { $ne: doc._id }, status: { $ne: 'duplicate' } }).sort({ createdAt: -1 }).limit(500).lean(),
  ]);

  const exclude = new Set([issue.id, issue.duplicateOf, ...mergedDocs.map((m) => String(m._id))].filter(Boolean));
  const pool = others.map((d) => serializeIssue(d, { keepEmbedding: true })).filter((i) => !exclude.has(i.id));
  const related = findSimilar(issue, pool, { exclude: issue.id, limit: 3 });

  return {
    ...stripEmbedding(issue),
    parent: parentDoc && { id: String(parentDoc._id), ticket: parentDoc.ticket, title: parentDoc.title, status: parentDoc.status },
    merged: mergedDocs.map((m) => ({ id: String(m._id), ticket: m.ticket, title: m.title, reporter: { id: String(m.reporter.id), name: m.reporter.name }, createdAt: iso(m.createdAt) })),
    related: related.map((r) => ({ id: r.issue.id, ticket: r.issue.ticket, title: r.issue.title, status: r.issue.status, location: r.issue.location, similarity: r.similarity })),
  };
}

// ------------------------------------------------------------------ AI preview + create
function validateDraft({ description }) {
  const text = String(description || '').trim();
  if (text.length < 10) throw httpError(400, 'Describe the problem in at least a few words.');
  if (text.length > 4000) throw httpError(400, 'Keep the description under 4000 characters.');
  return text;
}

/** POST /issues/analyze – triage a draft before it is submitted (live preview + duplicate check). */
export async function analyzeDraft({ description, category, location }) {
  const text = validateDraft({ description });
  const [{ ai, extracted }, embedding] = await Promise.all([analyzeReport(text, category), embedText(text)]);
  const candidates = await openCandidates();
  const similar = findSimilar({ description: text, category: ai.category, location: location || extracted.location, embedding }, candidates, { limit: 3 });
  const priority = computePriority({ ...ai, affectedCount: 1 });
  return {
    ai,
    priority,
    department: categoryById(ai.category).department,
    extracted,
    dispatch: dispatchFor(ai, priority),
    similar: similar.map((s) => ({ similarity: s.similarity, likelyDuplicate: s.similarity >= DUPLICATE_THRESHOLD, issue: summary(s.issue) })),
  };
}

/** POST /issues – store a new report, triage it, route it and notify admins. */
export async function createIssue(user, body, imagePaths = []) {
  const text = validateDraft(body);
  if (body.occurredAt) {
    const given = new Date(body.occurredAt);
    if (Number.isNaN(given.getTime()) || given.getTime() > Date.now() + 5 * 60000) {
      throw httpError(400, 'The time you noticed the problem is not valid.');
    }
  }

  // One step for the student: the AI reads type, severity, place, time and people affected from the text.
  const [{ ai, extracted }, embedding, candidates] = await Promise.all([analyzeReport(text, body.category), embedText(text), openCandidates()]);
  const department = categoryById(ai.category).department;
  const givenLocation = String(body.location || '').trim().slice(0, 160);
  const location = givenLocation || extracted.location || 'Not specified';
  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : extracted.occurredAt ? new Date(extracted.occurredAt) : new Date();
  const priority = computePriority({ ...ai, affectedCount: 1 });
  const dispatch = { ...dispatchFor(ai, priority), sentAt: new Date(), acknowledgedAt: null, acknowledgedBy: null, escalatedAt: null, escalations: 0 };
  const duplicates = findSimilar({ description: text, category: ai.category, location, embedding }, candidates, { limit: 3 })
    .filter((s) => s.similarity >= DUPLICATE_THRESHOLD);
  const n = await nextSequence('issue');
  const yy = String(new Date().getFullYear()).slice(-2);

  const doc = new Issue({
    ticket: `CC-${yy}-${String(n).padStart(4, '0')}`,
    title: makeTitle(text),
    description: text,
    category: ai.category,
    location,
    occurredAt,
    images: imagePaths,
    status: 'new',
    department,
    reporter: { id: user._id, name: user.name },
    affectedUsers: [user._id],
    affectedCount: 1,
    ai,
    priority,
    dispatch,
    extracted: { ...extracted, missing: location === 'Not specified' ? ['location'] : [], locationSource: givenLocation ? 'student' : extracted.location ? 'ai' : 'none' },
    embedding: embedding || undefined,
    timeline: [
      { status: 'new', at: new Date(), by: AI_ACTOR,
        note: `Classified as ${categoryById(ai.category).label} (${Math.round(ai.confidence * 100)}%), routed to ${departmentById(department).name}. ${extractionNote(extracted, Boolean(givenLocation))}` },
      { status: 'new', at: new Date(), by: AI_ACTOR, note: dispatchNote(dispatch) },
      ...duplicates.slice(0, 1).map((d) => ({ status: 'new', at: new Date(), by: AI_ACTOR,
        note: `Looks like ${d.issue.ticket} (${Math.round(d.similarity * 100)}% match). An administrator will review whether to merge.` })),
    ],
  });
  const json = await saveAndEmit(doc, 'issue:created');
  announce(json);
  return { ...json, possibleDuplicates: duplicates.map((d) => ({ ...summary(d.issue), similarity: d.similarity })) };
}

/** POST /issues/:id/acknowledge (admin) – clears the alert; a New report moves to Pending. */
export async function acknowledgeIssue(user, id, { note } = {}) {
  const doc = await findIssueDoc(id);
  if (!isOpen(doc.status)) throw httpError(409, 'This report is already closed.');
  const cleared = markAcknowledged(doc, user);
  const text = note ? String(note).trim().slice(0, 500) : null;
  if (doc.status === 'new') addTimeline(doc, 'pending', user.name, text || 'Acknowledged by the administration.');
  else if (cleared) addTimeline(doc, null, user.name, text || 'Alert acknowledged.');
  else return serializeIssue(doc);
  return saveAndEmit(doc);
}

/** PATCH /issues/:id/details – the reporter (or an admin) corrects what the AI read: place or issue type. */
export async function updateDetails(user, id, { location, category } = {}) {
  const doc = await findIssueDoc(id);
  const isAdmin = user.role === 'admin';
  if (!isAdmin && !sameId(doc.reporter.id, user._id)) throw httpError(403, 'Only the student who filed this report can change its details.');
  if (!isOpen(doc.status)) throw httpError(409, 'This report is closed, so its details can no longer change.');

  const changes = [];
  const place = location != null ? String(location).trim().slice(0, 160) : '';
  if (place && place !== doc.location) {
    doc.location = place;
    doc.extracted = { ...plain(doc.extracted), locationSource: isAdmin ? 'admin' : 'student', missing: [] };
    changes.push(`place set to "${place}"`);
  }
  if (category && category !== doc.category) {
    if (!CATEGORIES.some((c) => c.id === category)) throw httpError(400, 'Unknown issue type.');
    doc.category = category;
    doc.department = categoryById(category).department;
    changes.push(`type changed to ${categoryById(category).label}, routed to ${departmentById(doc.department).name}`);
  }
  if (!changes.length) throw httpError(400, 'Nothing to change.');
  addTimeline(doc, null, user.name, `Details corrected: ${changes.join('; ')}.`);
  return saveAndEmit(doc);
}

/** GET /issues/alerts (admin) – flagged reports nobody has acknowledged yet, most severe first. */
export async function listAlerts() {
  const docs = await Issue.find({ 'dispatch.level': { $in: FLAGGED }, 'dispatch.acknowledgedAt': null, status: { $in: OPEN_STATUSES } })
    .select('-embedding').lean();
  const items = docs.map((d) => serializeIssue(d))
    .sort((a, b) => rankOf(b.dispatch.level) - rankOf(a.dispatch.level) || b.createdAt.localeCompare(a.createdAt));
  return {
    items,
    counts: { critical: items.filter((i) => i.dispatch.level === 'critical').length, high: items.filter((i) => i.dispatch.level === 'high').length },
  };
}

const MAX_ESCALATIONS = 6;

/** Runs every minute (server.js): re-alerts flagged reports that nobody acknowledged in time. */
export async function escalateOverdue(now = new Date()) {
  const docs = await Issue.find({ 'dispatch.level': { $in: FLAGGED }, 'dispatch.acknowledgedAt': null, status: { $in: OPEN_STATUSES } });
  let count = 0;
  for (const doc of docs) {
    const minutes = doc.dispatch.level === 'critical' ? config.escalateCriticalMin : config.escalateHighMin;
    const since = doc.dispatch.escalatedAt || doc.dispatch.sentAt || doc.createdAt;
    if ((doc.dispatch.escalations || 0) >= MAX_ESCALATIONS || now - new Date(since) < minutes * 60000) continue;
    doc.dispatch.escalatedAt = now;
    doc.dispatch.escalations = (doc.dispatch.escalations || 0) + 1;
    addTimeline(doc, null, AI_ACTOR, `Not acknowledged within ${minutes} min. Administrators alerted again (reminder ${doc.dispatch.escalations}).`);
    const json = await saveAndEmit(doc);
    announce(json, { escalated: true });
    count += 1;
  }
  return count;
}

// ------------------------------------------------------------------ mutations
/** POST /issues/:id/join – "I'm affected too" instead of filing a duplicate. */
export async function joinIssue(user, id) {
  let doc = await findIssueDoc(id);
  if (doc.status === 'duplicate' && doc.duplicateOf) doc = await findIssueDoc(String(doc.duplicateOf));
  if (!isOpen(doc.status)) throw httpError(409, 'This report is already closed. Submit a new one if the problem is back.');
  if (doc.affectedUsers.some((u) => sameId(u, user._id))) return serializeIssue(doc);

  doc.affectedUsers.push(user._id);
  doc.affectedCount += 1;
  rescore(doc);
  addTimeline(doc, null, AI_ACTOR, `${user.name} reported the same problem. ${doc.affectedCount} students affected, priority now ${doc.priority.score}.`);
  const raised = upgradeDispatch(doc);
  const json = await saveAndEmit(doc);
  if (raised) announce(json);
  return json;
}

/** PATCH /issues/:id/status (admin). */
export async function updateStatus(user, id, { status, note }) {
  if (!STATUSES.some((s) => s.id === status)) throw httpError(400, 'Unknown status.');
  if (status === 'duplicate') throw httpError(400, 'Use merge to mark a report as a duplicate.');
  const doc = await findIssueDoc(id);
  const text = note ? String(note).trim().slice(0, 500) : null;
  if (status === doc.status && !text) throw httpError(400, 'Choose a different status or add a note.');
  markAcknowledged(doc, user);
  addTimeline(doc, status, user.name, text || null);
  return saveAndEmit(doc);
}

/**
 * PATCH /issues/:id/assign (admin) – hand the report to a team, in one click.
 * A New/Pending report can be assigned to the department the AI already chose (no change needed);
 * later calls re-route it and/or name a person. `note` is an optional message for the student.
 */
export async function assignIssue(user, id, { department, assignee, note }) {
  if (department && !DEPARTMENTS[department]) throw httpError(400, 'Unknown department.');
  const doc = await findIssueDoc(id);
  if (!isOpen(doc.status)) throw httpError(409, 'This report is closed. Reopen it first.');
  const person = assignee ? String(assignee).trim().slice(0, 80) : null;
  const changedDept = department && department !== doc.department;
  const changedPerson = person && person !== doc.assignee;
  const moveForward = ['new', 'pending'].includes(doc.status) ? 'assigned' : null;
  if (!moveForward && !changedDept && !changedPerson) throw httpError(400, 'Nothing to change.');

  if (department) doc.department = department;
  if (person) doc.assignee = person;
  markAcknowledged(doc, user);
  const text = note ? String(note).trim().slice(0, 500) : '';
  const what = moveForward ? 'Assigned to' : changedDept ? 'Re-routed to' : 'Assigned within';
  addTimeline(doc, moveForward, user.name,
    `${what} ${departmentById(doc.department).name}${doc.assignee ? ` · ${doc.assignee}` : ''}.${text ? ` ${text}` : ''}`);
  return saveAndEmit(doc);
}

/** POST /issues/:id/comments – reporter, joined students and admins can write. */
export async function addComment(user, id, { text }) {
  const body = String(text || '').trim();
  if (!body) throw httpError(400, 'Write a comment first.');
  if (body.length > 2000) throw httpError(400, 'Keep comments under 2000 characters.');
  const doc = await findIssueDoc(id);
  if (user.role !== 'admin' && !isInvolved(user, serializeIssue(doc))) {
    throw httpError(403, 'You can only comment on reports you submitted or joined.');
  }
  doc.comments.push({ author: user.name, authorId: user._id, role: user.role, text: body, at: new Date() });
  return saveAndEmit(doc);
}

/** POST /issues/:id/merge (admin) – close :id as a duplicate of `into`. Returns the primary. */
export async function mergeIssue(user, id, { into }) {
  if (!into) throw httpError(400, 'Choose the report to merge into.');
  const dup = await findIssueDoc(id);
  let primary = await findIssueDoc(into);
  if (primary.status === 'duplicate' && primary.duplicateOf) primary = await findIssueDoc(String(primary.duplicateOf));
  if (sameId(dup._id, primary._id)) throw httpError(400, 'A report cannot be merged into itself.');
  if (dup.status === 'duplicate') throw httpError(409, `${dup.ticket} is already merged.`);

  // Anything previously merged into the duplicate now points at the primary.
  const children = await Issue.find({ duplicateOf: dup._id });
  for (const child of children) {
    child.duplicateOf = primary._id;
    await child.save();
  }

  dup.duplicateOf = primary._id;
  addTimeline(dup, 'duplicate', user.name, `Merged into ${primary.ticket}.`);

  for (const uid of dup.affectedUsers) {
    if (!primary.affectedUsers.some((u) => sameId(u, uid))) primary.affectedUsers.push(uid);
  }
  primary.affectedCount += dup.affectedCount;
  rescore(primary);
  addTimeline(primary, null, user.name, `${dup.ticket} merged in. ${primary.affectedCount} students affected, priority now ${primary.priority.score}.`);
  markAcknowledged(dup, user);
  const raised = upgradeDispatch(primary);

  await saveAndEmit(dup);
  const json = await saveAndEmit(primary);
  if (raised) announce(json);
  return json;
}

// ------------------------------------------------------------------ admin overviews
/** GET /issues/duplicates – confirmed merge groups and AI suggestions awaiting review. */
export async function duplicateGroups() {
  const all = (await Issue.find({}).sort({ createdAt: -1 }).limit(1000).lean()).map((d) => serializeIssue(d, { keepEmbedding: true }));
  const byId = new Map(all.map((i) => [i.id, i]));

  const groups = new Map();
  all.filter((i) => i.duplicateOf && byId.has(i.duplicateOf)).forEach((m) => {
    if (!groups.has(m.duplicateOf)) groups.set(m.duplicateOf, []);
    groups.get(m.duplicateOf).push(stripEmbedding(m));
  });
  const confirmed = [...groups].map(([pid, members]) => ({ primary: stripEmbedding(byId.get(pid)), members }));

  const open = all.filter((i) => isOpen(i.status));
  const seen = new Set();
  const suggestions = [];
  open.forEach((a) => {
    findSimilar(a, open, { exclude: a.id, limit: 3 }).forEach(({ issue: b, similarity }) => {
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      const [primary, candidate] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
      suggestions.push({ primary: stripEmbedding(primary), candidate: stripEmbedding(candidate), similarity });
    });
  });
  suggestions.sort((x, y) => y.similarity - x.similarity);
  return { confirmed, suggestions };
}

/** GET /stats – numbers for the admin triage board. */
export async function stats() {
  const all = await Issue.find({}).select('status category department priority.level dispatch createdAt updatedAt').lean();
  const open = all.filter((i) => isOpen(i.status));
  const hot = (i) => ['critical', 'high'].includes(i.priority?.level);
  const weekAgo = Date.now() - 7 * 864e5;
  const count = (f) => all.filter(f).length;
  const done = all.filter((i) => i.status === 'resolved');

  return {
    counts: {
      new: count((i) => i.status === 'new'),
      pending: count((i) => i.status === 'pending'),
      high: open.filter(hot).length,
      assigned: count((i) => ['assigned', 'in_progress'].includes(i.status)),
      resolved: count((i) => i.status === 'resolved' && new Date(i.updatedAt).getTime() > weekAgo),
      duplicates: count((i) => i.status === 'duplicate'),
      flagged: open.filter((i) => FLAGGED.includes(i.dispatch?.level) && !i.dispatch?.acknowledgedAt).length,
    },
    byCategory: CATEGORIES.map((c) => ({ id: c.id, label: c.label, open: open.filter((i) => i.category === c.id).length })).filter((x) => x.open),
    byDepartment: Object.values(DEPARTMENTS).map((d) => ({
      id: d.id,
      label: d.short,
      open: open.filter((i) => i.department === d.id).length,
      critical: open.filter((i) => i.department === d.id && hot(i)).length,
    })).filter((x) => x.open),
    avgResolutionHours: done.length
      ? Math.round(done.reduce((s, i) => s + (new Date(i.updatedAt) - new Date(i.createdAt)) / 36e5, 0) / done.length)
      : null,
  };
}
