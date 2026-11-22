import { Router } from 'express';
import fs from 'node:fs/promises';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadImages, publicPath } from '../middleware/upload.js';
import { asyncHandler } from '../utils/http.js';
import * as issues from '../services/issue.service.js';

const router = Router();
const admin = requireRole('admin');

router.use(requireAuth);

// Order matters: fixed paths before "/:id".
router.get('/', admin, asyncHandler(async (req, res) => res.json(await issues.listIssues(req.query))));
router.get('/mine', asyncHandler(async (req, res) => res.json(await issues.myIssues(req.user))));
router.get('/duplicates', admin, asyncHandler(async (req, res) => res.json(await issues.duplicateGroups())));
router.get('/alerts', admin, asyncHandler(async (req, res) => res.json(await issues.listAlerts())));
router.post('/analyze', asyncHandler(async (req, res) => res.json(await issues.analyzeDraft(req.body || {}))));

router.post('/', uploadImages, asyncHandler(async (req, res) => {
  const files = req.files || [];
  try {
    const created = await issues.createIssue(req.user, req.body || {}, files.map(publicPath));
    res.status(201).json(created);
  } catch (err) {
    await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {}))); // don't keep photos of a rejected report
    throw err;
  }
}));

router.get('/:id', asyncHandler(async (req, res) => res.json(await issues.getIssueDetail(req.user, req.params.id))));
router.post('/:id/join', asyncHandler(async (req, res) => res.json(await issues.joinIssue(req.user, req.params.id))));
router.patch('/:id/details', asyncHandler(async (req, res) => res.json(await issues.updateDetails(req.user, req.params.id, req.body || {}))));
router.post('/:id/acknowledge', admin, asyncHandler(async (req, res) => res.json(await issues.acknowledgeIssue(req.user, req.params.id, req.body || {}))));
router.post('/:id/comments', asyncHandler(async (req, res) => res.json(await issues.addComment(req.user, req.params.id, req.body || {}))));
router.patch('/:id/status', admin, asyncHandler(async (req, res) => res.json(await issues.updateStatus(req.user, req.params.id, req.body || {}))));
router.patch('/:id/assign', admin, asyncHandler(async (req, res) => res.json(await issues.assignIssue(req.user, req.params.id, req.body || {}))));
router.post('/:id/merge', admin, asyncHandler(async (req, res) => res.json(await issues.mergeIssue(req.user, req.params.id, req.body || {}))));

export default router;
