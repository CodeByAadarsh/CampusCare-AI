/**
 * Built-in, explainable triage engine (no external model needed).
 * Used by the backend when no AI service is configured, and as the fallback if
 * the AI service is down. src/ai/index.js decides which one runs.
 *
 *   ai:       { category, confidence, alternatives[], severity 1-5, urgency 1-5, safetyImpact 0-1, signals[], model }
 *   priority: { score 0-100, level, breakdown[] }
 *
 * The priority formula is shared with the frontend so the UI can explain every score.
 */
import { CATEGORIES, levelForScore } from '../constants.js';

// ---------- text helpers ----------
const STOPWORDS = new Set(
  'a an the is are was were be been am i me my we our you your it its this that these those of in on at to for from with and or but not no so very too there here has have had do does did can could will would should just also near since by as up down out over again still please sir maam ma am'.split(' ')
);

export function tokenize(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

// Keyword must start at a word boundary, so "late" does not match inside "plate".
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, phrase) => new RegExp(`(?:^|[^a-z])${escapeRe(phrase)}`).test(` ${text} `);

/** Drop signals that are a prefix of a longer one ("danger" when "dangerous" is present). */
const dedupeSignals = (list) => [...new Set(list)].filter((w, _, all) => !all.some((o) => o !== w && o.startsWith(w)));

// ---------- category classification ----------
const CATEGORY_KEYWORDS = {
  electrical: ['wire', 'wiring', 'spark', 'switch', 'socket', 'plug', 'fan', 'light', 'bulb', 'tube light', 'power', 'electric', 'short circuit', 'mcb', 'voltage', 'ac ', 'air condition', 'projector power', 'shock'],
  plumbing: ['water', 'leak', 'tap', 'pipe', 'drain', 'cooler', 'flush', 'overflow', 'seepage', 'tank', 'ro ', 'purifier', 'drinking'],
  sanitation: ['dirty', 'garbage', 'trash', 'dustbin', 'smell', 'stink', 'clean', 'washroom', 'toilet', 'mosquito', 'pest', 'rats', 'cockroach', 'hygiene', 'waste'],
  security: ['cctv', 'camera', 'gate', 'guard', 'theft', 'stolen', 'stranger', 'unauthori', 'harass', 'lock', 'fight', 'id card', 'trespass', 'unsafe'],
  hostel: ['hostel', 'mess', 'room', 'warden', 'bed', 'curfew', 'laundry', 'roommate'],
  transport: ['bus', 'driver', 'route', 'transport', 'shuttle', 'parking', 'vehicle', 'pickup'],
  academic: ['class', 'lab', 'lecture', 'projector', 'smart board', 'board', 'faculty', 'timetable', 'exam', 'library', 'bench', 'attendance'],
  it: ['wifi', 'wi-fi', 'internet', 'network', 'lan', 'computer', 'pc', 'login', 'portal', 'printer', 'erp', 'server'],
  infrastructure: ['ceiling', 'wall', 'crack', 'door', 'window', 'glass', 'chair', 'desk', 'furniture', 'stair', 'lift', 'elevator', 'roof', 'plaster', 'floor', 'tile', 'paint', 'railing'],
};

export function classify(text) {
  const t = ` ${text.toLowerCase()} `;
  const scores = CATEGORIES.map((c) => {
    const hits = (CATEGORY_KEYWORDS[c.id] || []).filter((k) => has(t, k));
    return { category: c.id, score: hits.length, hits };
  }).sort((a, b) => b.score - a.score);

  const total = scores.reduce((s, x) => s + x.score, 0);
  if (!total) return { category: 'infrastructure', confidence: 0.34, alternatives: [], hits: [] };
  const top = scores[0];
  const confidence = Math.min(0.97, 0.45 + 0.55 * (top.score / total) * Math.min(1, top.score / 2));
  return {
    category: top.category,
    confidence: Math.round(confidence * 100) / 100,
    alternatives: scores.slice(1, 3).filter((s) => s.score > 0).map((s) => ({ category: s.category, confidence: Math.round((s.score / total) * 0.6 * 100) / 100 })),
    hits: top.hits,
  };
}

// ---------- severity / urgency / safety ----------
const SEVERITY_RULES = [
  { level: 5, words: ['spark', 'exposed wire', 'naked wire', 'live wire', 'shock', 'fire', 'smoke', 'burning', 'short circuit', 'gas leak', 'collapse', 'fell', 'injur', 'bleed', 'harass', 'assault', 'unconscious'] },
  { level: 4, words: ['leak', 'overflow', 'flood', 'broken', 'no water', 'no power', 'power cut', 'outage', 'lock', 'cctv', 'stuck', 'lift', 'elevator', 'theft', 'stolen', 'crack', 'seepage', 'unsafe', 'stranger'] },
  { level: 3, words: ['not working', "doesn't work", 'dirty', 'smell', 'blocked', 'clogged', 'slow', 'damaged', 'damage', 'dim', 'flicker', 'garbage', 'mosquito', 'late'] },
];
const URGENCY_UP = ['urgent', 'immediately', 'asap', 'right now', 'emergency', 'dangerous', 'danger', 'children', 'someone could', 'risk'];
const URGENCY_PERSIST = ['since', 'days', 'week', 'again', 'still', 'every day', 'exam', 'tonight', 'night', 'many students', 'everyone'];
const SAFETY_WORDS = ['spark', 'wire', 'shock', 'fire', 'smoke', 'gas', 'collapse', 'injur', 'harass', 'assault', 'theft', 'stranger', 'unsafe', 'crack', 'lift', 'elevator', 'slippery', 'cctv', 'gate', 'railing', 'danger'];

export function assess(text, category) {
  const t = text.toLowerCase();
  const signals = [];

  let severity = 2;
  for (const rule of SEVERITY_RULES) {
    const hit = rule.words.find((w) => has(t, w));
    if (hit) { severity = Math.max(severity, rule.level); signals.push(hit); }
  }

  let urgency = 2;
  const up = URGENCY_UP.filter((w) => has(t, w));
  const persist = URGENCY_PERSIST.filter((w) => has(t, w));
  if (up.length) urgency += 2;
  if (persist.length) urgency += 1;
  if (severity === 5) urgency = Math.max(urgency, 4);
  urgency = Math.min(5, urgency);
  signals.push(...up, ...persist);

  const safetyHits = SAFETY_WORDS.filter((w) => has(t, w));
  let safetyImpact = 0.1 + 0.25 * safetyHits.length;
  if (category === 'electrical' || category === 'security') safetyImpact += 0.2;
  if (severity === 5) safetyImpact = Math.max(safetyImpact, 0.9);
  safetyImpact = Math.min(1, Math.round(safetyImpact * 100) / 100);

  return { severity, urgency, safetyImpact, signals: dedupeSignals(signals).slice(0, 6) };
}

// ---------- priority score ----------
export const PRIORITY_WEIGHTS = { severity: 0.35, urgency: 0.25, safety: 0.25, reach: 0.15 };

/** Number of affected users mapped to 0–1 on a log scale: 1 → 0, 32+ → 1. */
export const reachFactor = (affectedCount = 1) => Math.min(1, Math.log2(Math.max(1, affectedCount)) / 5);

export function computePriority({ severity, urgency, safetyImpact, affectedCount = 1 }) {
  const parts = [
    { key: 'severity', label: 'Severity', weight: PRIORITY_WEIGHTS.severity, value: (severity - 1) / 4, raw: `${severity}/5` },
    { key: 'urgency', label: 'Urgency', weight: PRIORITY_WEIGHTS.urgency, value: (urgency - 1) / 4, raw: `${urgency}/5` },
    { key: 'safety', label: 'Safety impact', weight: PRIORITY_WEIGHTS.safety, value: safetyImpact, raw: `${Math.round(safetyImpact * 100)}%` },
    { key: 'reach', label: 'Students affected', weight: PRIORITY_WEIGHTS.reach, value: reachFactor(affectedCount), raw: String(affectedCount) },
  ].map((p) => ({ ...p, points: Math.round(p.weight * p.value * 1000) / 10 }));
  const score = Math.round(parts.reduce((s, p) => s + p.weight * p.value, 0) * 100);
  return { score, level: levelForScore(score), breakdown: parts };
}

export function analyze(text, categoryOverride) {
  const cls = classify(text);
  const category = categoryOverride || cls.category;
  const a = assess(text, category);
  return {
    category,
    confidence: categoryOverride && categoryOverride !== cls.category ? 1 : cls.confidence,
    suggestedCategory: cls.category,
    alternatives: cls.alternatives,
    ...a,
    signals: dedupeSignals([...cls.hits, ...a.signals]).slice(0, 8),
    model: 'keyword-rules-v1',
  };
}

// ---------- similarity (duplicate detection) ----------
function vector(tokens) {
  const v = new Map();
  tokens.forEach((t) => v.set(t, (v.get(t) || 0) + 1));
  return v;
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  a.forEach((x, k) => { na += x * x; if (b.has(k)) dot += x * b.get(k); });
  b.forEach((x) => { nb += x * x; });
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Words that appear in many locations and say nothing about *which* place it is.
const GENERIC_PLACE = new Set(['block', 'floor', 'ground', 'room', 'corridor', '2nd', '1st', '3rd', '4th', 'main', 'lab']);
const placeTokens = (loc = '') => tokenize(loc).filter((w) => !GENERIC_PLACE.has(w));

/** Cosine similarity of two embedding vectors (from a sentence-embedding model). */
export function cosineVectors(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Similarity in 0–1 between a draft report and an existing issue:
 * 75% text similarity (embeddings when both have them, otherwise bag-of-words cosine)
 * + 0.15 when the place matches + 0.10 when the category matches.
 */
export function similarity(draft, issue) {
  const embedded = cosineVectors(draft.embedding, issue.embedding);
  const text = embedded ?? cosine(vector(tokenize(draft.description)), vector(tokenize(`${issue.title} ${issue.description}`)));
  const a = placeTokens(draft.location);
  const b = placeTokens(issue.location);
  const sameLoc = draft.location && issue.location && (draft.location === issue.location || a.some((w) => b.includes(w))) ? 0.15 : 0;
  const sameCat = draft.category && draft.category === issue.category ? 0.1 : 0;
  return Math.min(1, Math.round((text * 0.75 + sameLoc + sameCat) * 100) / 100);
}

export const DUPLICATE_THRESHOLD = 0.62; // "likely the same issue"
export const RELATED_THRESHOLD = 0.4;  //  "possibly related"

export function findSimilar(draft, issues, { exclude, limit = 4 } = {}) {
  return issues
    .filter((i) => i.id !== exclude && i.status !== 'duplicate')
    .map((issue) => ({ issue, similarity: similarity(draft, issue) }))
    .filter((r) => r.similarity >= RELATED_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/** Short title from free text (the real backend may ask the LLM for a summary instead). */
export function makeTitle(text) {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0].replace(/\s+/g, ' ');
  const t = first.length > 64 ? `${first.slice(0, 61).replace(/\s\S*$/, '')}…` : first;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
