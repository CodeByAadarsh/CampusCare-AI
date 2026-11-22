/**
 * Single API surface used by every screen. With VITE_USE_MOCK=true calls go to the
 * in-browser mock; otherwise to the Express backend. Both return identical shapes.
 *
 * Backend contract (all JSON, JWT in Authorization header):
 *   POST   /auth/login                 { email, password, role }        -> { token, user }
 *   POST   /auth/register              { name, email, password, enrollment?, branch? } -> { token, user } (students)
 *   GET    /auth/me                                                      -> user
 *   GET    /issues?status&category&department&level&search&sort        -> { items, total }   (admin)
 *          status: open | todo (new+pending) | team (assigned+in progress) | flagged | high | all | a status id
 *   GET    /issues/mine                                                  -> { items }          (student)
 *   GET    /issues/:id                                                   -> issue + { parent, merged[], related[] }
 *   POST   /issues/analyze             { description, category?, location? } -> { ai, priority, department, similar[] }
 *   POST   /issues                     multipart: description, images[] (category, location, occurredAt optional:
 *                                      the AI reads them from the description) -> issue + possibleDuplicates[]
 *   POST   /issues/:id/join                                              -> issue   ("I'm affected too")
 *   PATCH  /issues/:id/status          { status, note }                  -> issue  (admin)
 *   PATCH  /issues/:id/assign          { department?, assignee?, note? } -> issue  (admin; New/Pending -> Assigned in one click)
 *   POST   /issues/:id/comments        { text }                          -> issue
 *   POST   /issues/:id/merge           { into }                          -> primary issue (admin)
 *   GET    /issues/duplicates                                            -> { confirmed[], suggestions[] } (admin)
 *   GET    /stats                                                        -> dashboard aggregates (admin)
 *   GET    /issues/alerts                                                -> { items, counts } flagged + unacknowledged (admin)
 *   POST   /issues/:id/acknowledge     { note? }                         -> issue (admin)
 *   PATCH  /issues/:id/details         { location?, category? }          -> issue (reporter or admin)
 *
 * Socket.IO events (server -> client): issue:created, issue:updated, issue:flagged ({ issue, escalated }, admins only)
 */
import { USE_MOCK } from '../config.js';
import http from './http.js';
import * as mock from './mockServer.js';

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

const real = {
  login: (body) => http.post('/auth/login', body),
  register: (body) => http.post('/auth/register', body),
  me: () => http.get('/auth/me'),
  listIssues: (params) => http.get('/issues', { params }),
  myIssues: () => http.get('/issues/mine'),
  getIssue: (id) => http.get(`/issues/${id}`),
  analyzeDraft: (body) => http.post('/issues/analyze', body),
  createIssue: ({ images = [], ...fields }) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => v != null && form.append(k, v));
    images.forEach((src, i) => form.append('images', dataUrlToBlob(src), `photo-${i + 1}.jpg`));
    return http.post('/issues', form);
  },
  joinIssue: (id) => http.post(`/issues/${id}/join`),
  updateStatus: (id, body) => http.patch(`/issues/${id}/status`, body),
  assignIssue: (id, body) => http.patch(`/issues/${id}/assign`, body),
  addComment: (id, body) => http.post(`/issues/${id}/comments`, body),
  mergeIssue: (id, body) => http.post(`/issues/${id}/merge`, body),
  duplicateGroups: () => http.get('/issues/duplicates'),
  stats: () => http.get('/stats'),
  listAlerts: () => http.get('/issues/alerts'),
  acknowledgeIssue: (id, body = {}) => http.post(`/issues/${id}/acknowledge`, body),
  updateDetails: (id, body) => http.patch(`/issues/${id}/details`, body),
};

const api = USE_MOCK
  ? {
      login: mock.login, register: mock.register, me: mock.me, listIssues: mock.listIssues, myIssues: mock.myIssues, getIssue: mock.getIssue,
      analyzeDraft: mock.analyzeDraft, createIssue: mock.createIssue, joinIssue: mock.joinIssue,
      updateStatus: mock.updateStatus, assignIssue: mock.assignIssue, addComment: mock.addComment,
      mergeIssue: mock.mergeIssue, duplicateGroups: mock.duplicateGroups, stats: mock.stats,
      listAlerts: mock.listAlerts, acknowledgeIssue: mock.acknowledgeIssue, updateDetails: mock.updateDetails,
    }
  : real;

export default api;

/** Demo-only helpers (no-ops against the real backend). */
export const demo = USE_MOCK
  ? { simulateIncoming: mock.simulateIncoming, reset: mock.resetDemoData }
  : null;
