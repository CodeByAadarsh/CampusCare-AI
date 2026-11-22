import 'dotenv/config';
import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT) || 8000,
  isProd: env.NODE_ENV === 'production',
  mongoUri: env.MONGO_URI || 'mongodb://127.0.0.1:27017/campuscare',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
  clientOrigins: (env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  allowedEmailDomain: (env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase(),
  uploadDir: path.resolve(env.UPLOAD_DIR || 'uploads'),
  aiServiceUrl: (env.AI_SERVICE_URL || '').replace(/\/$/, ''),
  aiTimeoutMs: Number(env.AI_TIMEOUT_MS) || 4000,
  // Automatic dispatch: re-alert admins when a flagged report is not acknowledged in time (minutes).
  escalateCriticalMin: Number(env.ESCALATE_CRITICAL_MIN) || 15,
  escalateHighMin: Number(env.ESCALATE_HIGH_MIN) || 120,
  // Optional: also post alerts to a Slack / Microsoft Teams / Discord incoming webhook.
  alertWebhookUrl: (env.ALERT_WEBHOOK_URL || '').trim(),
  alertWebhookLevel: (env.ALERT_WEBHOOK_LEVEL || 'critical').trim().toLowerCase(),
  appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
};

if (config.isProd && config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('Set JWT_SECRET in the environment before running in production.');
}
