/**
 * AI facade used by the rest of the backend.
 *
 * If AI_SERVICE_URL is set, requests go to an external model service
 * (e.g. Python/FastAPI running a fine-tuned BERT classifier and a sentence-embedding model):
 *
 *   POST {AI_SERVICE_URL}/analyze  { description, category? }
 *        -> { category, confidence, severity, urgency, safetyImpact, signals?, alternatives?, model? }
 *   POST {AI_SERVICE_URL}/embed    { text }
 *        -> { embedding: number[] }
 *
 * Otherwise (or if that service fails) the built-in keyword engine in ./triage.js is used,
 * so the system always keeps working.
 */
import { config } from '../config.js';
import { CATEGORIES } from '../constants.js';
import * as triage from './triage.js';
import { extractDetails } from './extract.js';

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

async function callService(path, body) {
  const res = await fetch(`${config.aiServiceUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.aiTimeoutMs),
  });
  if (!res.ok) throw new Error(`AI service ${path} returned ${res.status}`);
  return res.json();
}

/** Normalises whatever the model service returns into the shape the app stores. */
function normalise(raw, description, categoryOverride) {
  const local = triage.analyze(description, categoryOverride);
  const suggested = CATEGORY_IDS.has(raw.category) ? raw.category : local.suggestedCategory;
  const category = categoryOverride && CATEGORY_IDS.has(categoryOverride) ? categoryOverride : suggested;
  return {
    category,
    confidence: categoryOverride && categoryOverride !== suggested ? 1 : clamp(Number(raw.confidence) || local.confidence, 0, 1),
    suggestedCategory: suggested,
    alternatives: Array.isArray(raw.alternatives) ? raw.alternatives.filter((a) => CATEGORY_IDS.has(a.category)).slice(0, 3) : local.alternatives,
    severity: clamp(Math.round(Number(raw.severity) || local.severity), 1, 5),
    urgency: clamp(Math.round(Number(raw.urgency) || local.urgency), 1, 5),
    safetyImpact: clamp(Number(raw.safetyImpact ?? local.safetyImpact), 0, 1),
    signals: Array.isArray(raw.signals) ? raw.signals.slice(0, 8) : local.signals,
    model: raw.model || 'ai-service',
  };
}

/** Checks details returned by the AI service; anything missing or invalid comes from the built-in extractor. */
function normaliseExtracted(raw, description) {
  const local = extractDetails(description);
  if (!raw || typeof raw !== 'object') return local;
  const when = raw.occurredAt ? new Date(raw.occurredAt) : null;
  const validWhen = when && !Number.isNaN(when.getTime()) && when.getTime() <= Date.now() + 5 * 60000;
  const location = typeof raw.location === 'string' && raw.location.trim() ? raw.location.trim().slice(0, 160) : local.location;
  return {
    location,
    occurredAt: validWhen ? when.toISOString() : local.occurredAt,
    whenText: typeof raw.whenText === 'string' ? raw.whenText.slice(0, 80) : local.whenText,
    recurring: typeof raw.recurring === 'boolean' ? raw.recurring : local.recurring,
    peopleCount: Number.isFinite(raw.peopleCount) ? Math.min(500, Math.max(1, Math.round(raw.peopleCount))) : local.peopleCount,
    manyAffected: typeof raw.manyAffected === 'boolean' ? raw.manyAffected : local.manyAffected,
    missing: location ? [] : ['location'],
  };
}

/**
 * Full AI analysis of a report: triage (type, severity, urgency, safety) plus the details read
 * from the text (location, time noticed, people affected). Falls back to the built-in engine.
 */
export async function analyzeReport(description, categoryOverride) {
  const override = CATEGORY_IDS.has(categoryOverride) ? categoryOverride : undefined;
  if (config.aiServiceUrl) {
    try {
      const raw = await callService('/analyze', { description, category: override });
      return { ai: normalise(raw, description, override), extracted: normaliseExtracted(raw.extracted, description) };
    } catch (err) {
      console.warn(`[ai] ${err.message} – using built-in triage`);
    }
  }
  return { ai: triage.analyze(description, override), extracted: extractDetails(description) };
}

/** Classifies a report and estimates severity, urgency and safety impact. */
export async function analyzeText(description, categoryOverride) {
  return (await analyzeReport(description, categoryOverride)).ai;
}

/** Sentence embedding for duplicate detection, or null when no AI service is configured. */
export async function embedText(text) {
  if (!config.aiServiceUrl) return null;
  try {
    const { embedding } = await callService('/embed', { text });
    return Array.isArray(embedding) && embedding.length ? embedding.map(Number) : null;
  } catch (err) {
    console.warn(`[ai] ${err.message} – duplicate check falls back to word overlap`);
    return null;
  }
}

/** For /api/health: which engine is in use and whether the AI service answers. */
export async function aiStatus() {
  if (!config.aiServiceUrl) return { engine: 'built-in', model: 'keyword-rules-v1' };
  try {
    const res = await fetch(`${config.aiServiceUrl}/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return { engine: 'ai-service', url: config.aiServiceUrl, status: body.ok ? 'up' : 'starting', classifier: body.classifier, embedder: body.embedder };
  } catch {
    return { engine: 'built-in (AI service unreachable)', url: config.aiServiceUrl, status: 'down', model: 'keyword-rules-v1' };
  }
}

export { extractDetails };
export const computePriority = triage.computePriority;
export const findSimilar = triage.findSimilar;
export const makeTitle = triage.makeTitle;
export const DUPLICATE_THRESHOLD = triage.DUPLICATE_THRESHOLD;
