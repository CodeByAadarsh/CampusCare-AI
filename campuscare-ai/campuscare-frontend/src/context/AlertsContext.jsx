/**
 * Admin alerts for automatically dispatched reports.
 * - Keeps the list of flagged reports nobody has acknowledged yet (GET /issues/alerts).
 * - On a live `issue:flagged` event: refreshes, plays a short alarm for critical reports (can be muted)
 *   and shows a desktop notification when the admin has allowed them.
 * - Critical alerts stay in the banner until acknowledged; "Hide" only hides them in this tab,
 *   and an escalation (still unacknowledged after the time limit) brings them back.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/index.js';
import { useAuth } from './AuthContext.jsx';
import { useRealtimeEvent } from '../realtime/RealtimeContext.jsx';
import { DISPATCH } from '../lib/constants.js';

const AlertsContext = createContext({ items: [], counts: { critical: 0, high: 0 }, banner: [], muted: false });
const MUTE_KEY = 'campuscare.alerts.muted';

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

/** Two short tones, three times. Uses Web Audio, so no sound file is needed. */
function playAlarm() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.45, 0.9].forEach((start) => {
      [[880, 0], [660, 0.18]].forEach(([freq, offset]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start + offset);
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + start + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + offset + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start + offset);
        osc.stop(ctx.currentTime + start + offset + 0.18);
      });
    });
    setTimeout(() => ctx.close(), 1800);
  } catch { /* audio blocked until the page has been clicked once */ }
}

function desktopNotify(issue, escalated) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const level = DISPATCH[issue.dispatch.level].label.toUpperCase();
    const n = new Notification(`${escalated ? 'Still waiting: ' : ''}${level} · ${issue.ticket}`, {
      body: `${issue.title}\n${issue.location}`,
      tag: `campuscare-${issue.id}`,
      requireInteraction: issue.dispatch.level === 'critical',
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* notifications unavailable */ }
}

export function AlertsProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState({ items: [], counts: { critical: 0, high: 0 } });
  const [hidden, setHidden] = useState(() => new Set());
  const [muted, setMuted] = useState(readMuted);
  const [permission, setPermission] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const reload = useCallback(async () => {
    if (!isAdmin) return;
    try { setData(await api.listAlerts()); } catch { /* keep the last list */ }
  }, [isAdmin]);

  useEffect(() => { reload(); }, [reload]);
  useRealtimeEvent(['issue:created', 'issue:updated', 'issue:reset'], () => reload());
  useRealtimeEvent('issue:flagged', (payload) => {
    if (!isAdmin || !payload?.issue) return;
    const { issue, escalated } = payload;
    if (escalated) setHidden((h) => { const next = new Set(h); next.delete(issue.id); return next; });
    if (issue.dispatch?.level === 'critical' && !mutedRef.current) playAlarm();
    desktopNotify(issue, escalated);
    reload();
  });

  const acknowledge = useCallback(async (id) => {
    const updated = await api.acknowledgeIssue(id);
    await reload();
    return updated;
  }, [reload]);

  const value = useMemo(() => ({
    items: data.items,
    counts: data.counts,
    banner: data.items.filter((i) => i.dispatch.level === 'critical' && !hidden.has(i.id)),
    acknowledge,
    hide: (id) => setHidden((h) => new Set(h).add(id)),
    reload,
    muted,
    toggleMuted: () => setMuted((m) => {
      try { localStorage.setItem(MUTE_KEY, m ? '0' : '1'); } catch { /* storage blocked */ }
      if (m) playAlarm(); // unmuting plays the sound once so the admin knows what to listen for
      return !m;
    }),
    permission,
    requestPermission: async () => {
      try { setPermission(await Notification.requestPermission()); } catch { /* unsupported */ }
    },
  }), [data, hidden, acknowledge, reload, muted, permission]);

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export const useAlerts = () => useContext(AlertsContext);
