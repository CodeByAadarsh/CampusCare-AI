/**
 * Brings reports created before automatic dispatch up to date, without deleting anything:
 *   - extracted: place / time / people read from the description (the stored place is kept as the student's)
 *   - dispatch:  flag level from the stored AI scores; reports already past "new" (or closed) count as acknowledged
 *   - embedding: added when the AI service is connected and the report has none (--all recomputes every one,
 *                e.g. after switching the AI service to Sentence-BERT)
 *
 *   npm run ai:backfill            # only reports that are missing something
 *   npm run ai:backfill -- --all   # also recompute every embedding
 *
 * Safe to run while the server is running (MongoDB is shared) and safe to run twice.
 */
import { connectDB, disconnectDB } from '../src/db.js';
import { config } from '../src/config.js';
import { Issue } from '../src/models/Issue.js';
import { extractDetails, embedText, aiStatus } from '../src/ai/index.js';
import { dispatchFor } from '../src/ai/dispatch.js';

const ALL = process.argv.includes('--all');

function dispatchForOld(doc) {
  const { level, reasons } = dispatchFor(doc.ai || {}, doc.priority || { level: 'low', score: 0 });
  const handled = doc.status !== 'new'; // an admin has already acted on it (or it is closed)
  // first admin step in the timeline = when it was acknowledged
  const firstAdminStep = (doc.timeline || []).find((t) => t.status && t.status !== 'new');
  return {
    level,
    reasons,
    sentAt: doc.createdAt,
    acknowledgedAt: handled ? (firstAdminStep?.at || doc.updatedAt || doc.createdAt) : null,
    acknowledgedBy: handled ? (firstAdminStep?.by || 'Administration') : null,
    escalatedAt: null,
    escalations: 0,
  };
}

function extractedForOld(doc) {
  const ex = extractDetails(doc.description || '', new Date(doc.createdAt || Date.now()));
  const hasPlace = doc.location && doc.location !== 'Not specified';
  return {
    ...ex,
    location: hasPlace ? doc.location : ex.location,
    locationSource: hasPlace ? 'student' : ex.location ? 'ai' : 'none',
    missing: hasPlace || ex.location ? [] : ['location'],
  };
}

async function main() {
  await connectDB();
  const ai = await aiStatus();
  const canEmbed = Boolean(config.aiServiceUrl) && ai.status === 'up';
  if (!canEmbed) console.log('AI service not connected: embeddings are skipped (dispatch and extracted details are still added).');

  const docs = await Issue.find({}).lean();
  const counts = { dispatch: 0, extracted: 0, embedding: 0, unacknowledgedFlagged: 0 };
  for (const doc of docs) {
    const set = {};
    if (!doc.dispatch?.level) {
      set.dispatch = dispatchForOld(doc);
      counts.dispatch += 1;
      if (set.dispatch.level !== 'normal' && !set.dispatch.acknowledgedAt) counts.unacknowledgedFlagged += 1;
    }
    if (!doc.extracted?.locationSource) {
      set.extracted = extractedForOld(doc);
      counts.extracted += 1;
    }
    if (canEmbed && (ALL || !doc.embedding?.length)) {
      const embedding = await embedText(doc.description || doc.title || '');
      if (embedding) { set.embedding = embedding; counts.embedding += 1; }
    }
    // timestamps:false keeps "last updated" as it was
    if (Object.keys(set).length) await Issue.updateOne({ _id: doc._id }, { $set: set }, { timestamps: false });
  }

  console.log(`Checked ${docs.length} reports. Added dispatch to ${counts.dispatch}, extracted details to ${counts.extracted}, embeddings to ${counts.embedding}.`);
  if (counts.unacknowledgedFlagged) {
    console.log(`${counts.unacknowledgedFlagged} older critical/high reports are still "new", so they now appear in the admins' alert list.`);
  }
  await disconnectDB();
}

main().catch(async (err) => {
  console.error('Upgrade failed:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
