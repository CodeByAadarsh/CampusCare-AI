/**
 * Alerts for administrators outside the dashboard.
 * If ALERT_WEBHOOK_URL is set, flagged reports are also posted to that incoming webhook
 * (Slack, Microsoft Teams and Discord all accept this body). The dashboard alerts work without it.
 */
import { config } from '../config.js';
import { DISPATCH_LEVELS, rankOf } from '../ai/dispatch.js';
import { departmentById } from '../constants.js';

export async function sendWebhook(issue, { escalated = false } = {}) {
  const url = config.alertWebhookUrl;
  const level = issue.dispatch?.level;
  if (!url || !level || rankOf(level) < rankOf(config.alertWebhookLevel)) return false;

  const text = [
    `${escalated ? 'STILL NOT ACKNOWLEDGED – ' : ''}${DISPATCH_LEVELS[level].label.toUpperCase()} campus issue ${issue.ticket}: ${issue.title}`,
    `Where: ${issue.location} · Department: ${departmentById(issue.department).name} · Priority ${issue.priority.score}/100`,
    `Why: ${issue.dispatch.reasons.join(', ')}`,
    `${config.appUrl}/admin/issues/${issue.id}`,
  ].join('\n');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.warn(`[alerts] webhook for ${issue.ticket} failed: ${err.message}`);
    return false;
  }
}
