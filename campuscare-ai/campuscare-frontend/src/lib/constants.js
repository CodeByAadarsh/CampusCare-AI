// Shared domain vocabulary. Keep these ids in sync with the backend enums.

export const DEPARTMENTS = {
  electrical: { id: 'electrical', name: 'Electrical Maintenance', short: 'Electrical' },
  civil: { id: 'civil', name: 'Civil & Plumbing', short: 'Civil' },
  housekeeping: { id: 'housekeeping', name: 'Housekeeping', short: 'Housekeeping' },
  security: { id: 'security', name: 'Security Office', short: 'Security' },
  hostel: { id: 'hostel', name: 'Hostel Administration', short: 'Hostel' },
  transport: { id: 'transport', name: 'Transport Office', short: 'Transport' },
  academic: { id: 'academic', name: 'Academic Affairs', short: 'Academic' },
  it: { id: 'it', name: 'IT Services', short: 'IT' },
};

export const CATEGORIES = [
  { id: 'electrical', label: 'Electrical', department: 'electrical', icon: 'zap' },
  { id: 'plumbing', label: 'Water & plumbing', department: 'civil', icon: 'droplet' },
  { id: 'sanitation', label: 'Sanitation', department: 'housekeeping', icon: 'trash' },
  { id: 'security', label: 'Security', department: 'security', icon: 'shield' },
  { id: 'hostel', label: 'Hostel', department: 'hostel', icon: 'home' },
  { id: 'transport', label: 'Transport', department: 'transport', icon: 'truck' },
  { id: 'academic', label: 'Classrooms & labs', department: 'academic', icon: 'book' },
  { id: 'it', label: 'Wi-Fi & IT', department: 'it', icon: 'wifi' },
  { id: 'infrastructure', label: 'Building & furniture', department: 'civil', icon: 'tool' },
];

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
export const departmentById = (id) => DEPARTMENTS[id] || { id, name: id || 'Unassigned', short: id || '—' };

// Lifecycle of a report. "duplicate" closes a report that was merged into another one.
export const STATUSES = [
  { id: 'new', label: 'New', open: true },
  { id: 'pending', label: 'Pending', open: true },
  { id: 'assigned', label: 'Assigned', open: true },
  { id: 'in_progress', label: 'In progress', open: true },
  { id: 'resolved', label: 'Resolved', open: false },
  { id: 'duplicate', label: 'Merged', open: false },
];
export const statusById = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
export const isOpen = (status) => statusById(status).open;

// Priority bands applied to the 0–100 priority score.
export const PRIORITY_LEVELS = [
  { id: 'critical', label: 'Critical', min: 75 },
  { id: 'high', label: 'High', min: 55 },
  { id: 'medium', label: 'Medium', min: 35 },
  { id: 'low', label: 'Low', min: 0 },
];
export const levelForScore = (score) => PRIORITY_LEVELS.find((l) => score >= l.min).id;
export const levelLabel = (id) => (PRIORITY_LEVELS.find((l) => l.id === id) || PRIORITY_LEVELS[3]).label;

// Automatic dispatch flags (thresholds live in lib/dispatch.js, same as the backend).
export const DISPATCH = {
  critical: { id: 'critical', label: 'Critical', short: 'Critical alert', note: 'Administrators were alerted immediately.' },
  high: { id: 'high', label: 'High', short: 'Flagged high', note: 'Flagged for administrators to act on soon.' },
  normal: { id: 'normal', label: 'Normal', short: 'Sent to admin', note: 'In the administration queue.' },
};
export const isFlagged = (issue) => ['critical', 'high'].includes(issue?.dispatch?.level);
export const needsAck = (issue) => isFlagged(issue) && !issue.dispatch.acknowledgedAt && isOpen(issue.status);

export const COMMON_LOCATIONS = [
  'Block A – ground floor',
  'Block B – 2nd floor corridor',
  'ECE Lab 3',
  'Central Library',
  'Canteen',
  'Boys Hostel',
  'Girls Hostel',
  'Main gate / parking',
  'Auditorium',
];
