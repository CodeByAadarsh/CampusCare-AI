import http from 'node:http';
import { config } from './config.js';
import { connectDB } from './db.js';
import { createApp } from './app.js';
import { initSocket } from './realtime/socket.js';
import { escalateOverdue } from './services/issue.service.js';

async function main() {
  await connectDB();
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(config.port, () => {
    console.log(`CampusCare API on http://localhost:${config.port}/api`);
    console.log(`Allowed frontend origin(s): ${config.clientOrigins.join(', ')}`);
    console.log(`AI triage: ${config.aiServiceUrl ? `external service at ${config.aiServiceUrl}` : 'built-in keyword engine'}`);
    console.log(`Auto-dispatch: re-alert unacknowledged critical reports after ${config.escalateCriticalMin} min, high after ${config.escalateHighMin} min${config.alertWebhookUrl ? `; webhook on for ${config.alertWebhookLevel}+` : ''}`);
  });

  // Re-alert admins about flagged reports nobody has acknowledged.
  const escalation = setInterval(() => {
    escalateOverdue().then((n) => n && console.log(`[dispatch] re-alerted ${n} unacknowledged report(s)`)).catch((err) => console.warn('[dispatch]', err.message));
  }, 60 * 1000);

  const shutdown = () => { clearInterval(escalation); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  if (/ECONNREFUSED|querySrv|Authentication failed/i.test(err.message)) {
    console.error('Check MONGO_URI in .env and that MongoDB is running (or your Atlas IP access list allows you).');
  }
  process.exit(1);
});
