import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { config } from './config.js';
import { aiStatus } from './ai/index.js';
import authRoutes from './routes/auth.routes.js';
import issueRoutes from './routes/issues.routes.js';
import statsRoutes from './routes/stats.routes.js';
import { notFound, errorHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientOrigins }));
  app.use(express.json({ limit: '1mb' }));
  if (!config.isProd) app.use(morgan('dev'));

  app.get('/api/health', async (req, res) =>
    res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', ai: await aiStatus() })
  );

  // Uploaded photos. Under /api so the Vite dev proxy forwards them too.
  app.use('/api/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false }));

  app.use('/api/auth', authRoutes);
  app.use('/api/issues', issueRoutes);
  app.use('/api', statsRoutes);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
