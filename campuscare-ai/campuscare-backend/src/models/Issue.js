import mongoose from 'mongoose';
import { CATEGORIES, DEPARTMENTS, STATUSES, PRIORITY_LEVELS } from '../constants.js';

const { Schema } = mongoose;

const timelineSchema = new Schema(
  {
    status: { type: String, enum: STATUSES.map((s) => s.id), required: true },
    at: { type: Date, default: Date.now },
    by: { type: String, required: true }, // display name, or "CampusCare AI"
    note: { type: String, default: null },
  },
  { _id: false }
);

const commentSchema = new Schema({
  author: { type: String, required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User' },
  role: { type: String, enum: ['student', 'admin'], required: true },
  text: { type: String, required: true, maxlength: 2000 },
  at: { type: Date, default: Date.now },
});

const aiSchema = new Schema(
  {
    category: String,
    confidence: Number,
    suggestedCategory: String,
    alternatives: [{ _id: false, category: String, confidence: Number }],
    severity: { type: Number, min: 1, max: 5 },
    urgency: { type: Number, min: 1, max: 5 },
    safetyImpact: { type: Number, min: 0, max: 1 },
    signals: [String],
    model: String,
  },
  { _id: false }
);

const prioritySchema = new Schema(
  {
    score: { type: Number, min: 0, max: 100 },
    level: { type: String, enum: PRIORITY_LEVELS.map((l) => l.id) },
    breakdown: [{ _id: false, key: String, label: String, weight: Number, value: Number, raw: String, points: Number }],
  },
  { _id: false }
);

// Automatic dispatch to administrators (see src/ai/dispatch.js).
const dispatchSchema = new Schema(
  {
    level: { type: String, enum: ['critical', 'high', 'normal'], default: 'normal' },
    reasons: [String],
    sentAt: { type: Date, default: Date.now },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: String, default: null },
    escalatedAt: { type: Date, default: null },
    escalations: { type: Number, default: 0 },
  },
  { _id: false }
);

// Details the AI read from the description (see src/ai/extract.js).
const extractedSchema = new Schema(
  {
    location: { type: String, default: null },
    locationSource: { type: String, enum: ['ai', 'student', 'admin', 'none'], default: 'none' },
    occurredAt: { type: Date, default: null },
    whenText: { type: String, default: null },
    recurring: { type: Boolean, default: false },
    peopleCount: { type: Number, default: null },
    manyAffected: { type: Boolean, default: false },
    missing: [String],
  },
  { _id: false }
);

const issueSchema = new Schema(
  {
    ticket: { type: String, required: true, unique: true },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, required: true, minlength: 10, maxlength: 4000 },
    category: { type: String, enum: CATEGORIES.map((c) => c.id), required: true },
    location: { type: String, default: 'Not specified', maxlength: 160 },
    occurredAt: { type: Date, default: Date.now },
    images: [String], // public paths, e.g. /api/uploads/ab12cd.jpg
    status: { type: String, enum: STATUSES.map((s) => s.id), default: 'new' },
    department: { type: String, enum: Object.keys(DEPARTMENTS), required: true },
    assignee: { type: String, default: null },
    reporter: {
      id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      name: { type: String, required: true },
    },
    affectedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    affectedCount: { type: Number, default: 1, min: 1 },
    ai: aiSchema,
    priority: prioritySchema,
    dispatch: dispatchSchema,
    extracted: extractedSchema,
    embedding: { type: [Number], default: undefined }, // sentence embedding from the AI service (optional)
    duplicateOf: { type: Schema.Types.ObjectId, ref: 'Issue', default: null },
    comments: [commentSchema],
    timeline: [timelineSchema],
  },
  { timestamps: true }
);

issueSchema.index({ status: 1, 'priority.score': -1 });
issueSchema.index({ department: 1, status: 1 });
issueSchema.index({ 'reporter.id': 1 });
issueSchema.index({ affectedUsers: 1 });
issueSchema.index({ duplicateOf: 1 });
issueSchema.index({ 'dispatch.level': 1, 'dispatch.acknowledgedAt': 1 });

export const Issue = mongoose.model('Issue', issueSchema);
