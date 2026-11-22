import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';
import { stats } from '../services/issue.service.js';
import { CATEGORIES, DEPARTMENTS, STATUSES, PRIORITY_LEVELS } from '../constants.js';
import { DISPATCH_LEVELS } from '../ai/dispatch.js';

const router = Router();

/** GET /api/stats – dashboard aggregates (admin). */
router.get('/stats', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => res.json(await stats())));

/** GET /api/meta – enums, handy for other clients (mobile app, AI service). */
router.get('/meta', (req, res) => res.json({ categories: CATEGORIES, departments: Object.values(DEPARTMENTS), statuses: STATUSES, priorityLevels: PRIORITY_LEVELS, dispatchLevels: Object.values(DISPATCH_LEVELS) }));

export default router;
