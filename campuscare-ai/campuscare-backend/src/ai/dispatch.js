/**
 * Automatic dispatch: every report is sent to the administrators the moment it is filed,
 * with a flag level decided from the AI's severity, urgency, safety risk and the priority score.
 *
 *   critical  priority Critical (score >= 75), OR severity 5, OR safety risk >= 80%
 *             -> red alert banner + sound on every admin screen, webhook alert, escalation if unacknowledged
 *   high      priority High (>= 55), OR severity 4, OR urgency 5, OR safety risk >= 50%
 *             -> flagged and pinned in "Needs attention"
 *   normal    everything else -> delivered to the admin queue with a notification
 *
 * The thresholds are deliberately readable so the decision can be explained to students and admins.
 */
export const DISPATCH_LEVELS = {
  critical: { id: 'critical', label: 'Critical', rank: 3, acknowledgeWithinMin: 15 },
  high: { id: 'high', label: 'High', rank: 2, acknowledgeWithinMin: 120 },
  normal: { id: 'normal', label: 'Normal', rank: 1, acknowledgeWithinMin: null },
};

const pctText = (x) => `${Math.round(x * 100)}%`;

export function dispatchFor(ai, priority) {
  const critical = [];
  if (priority.level === 'critical') critical.push(`priority ${priority.score}/100`);
  if (ai.severity >= 5) critical.push('severity 5/5');
  if (ai.safetyImpact >= 0.8) critical.push(`safety risk ${pctText(ai.safetyImpact)}`);
  if (critical.length) return { level: 'critical', reasons: critical };

  const high = [];
  if (priority.level === 'high') high.push(`priority ${priority.score}/100`);
  if (ai.severity === 4) high.push('severity 4/5');
  if (ai.urgency >= 5) high.push('urgency 5/5');
  if (ai.safetyImpact >= 0.5) high.push(`safety risk ${pctText(ai.safetyImpact)}`);
  if (high.length) return { level: 'high', reasons: high };

  return { level: 'normal', reasons: [`priority ${priority.score}/100`] };
}

export const rankOf = (level) => DISPATCH_LEVELS[level]?.rank ?? 0;
