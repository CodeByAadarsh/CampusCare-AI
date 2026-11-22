import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { LiveDot } from './ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useRealtimeEvent } from '../realtime/RealtimeContext.jsx';
import { initials } from '../lib/format.js';
import { DISPATCH, statusById } from '../lib/constants.js';
import { AlertsProvider } from '../context/AlertsContext.jsx';
import { AlertBell, CriticalBanner } from './Alerts.jsx';
import { USE_MOCK } from '../config.js';

const NAV = {
  student: [
    { to: '/student/report', icon: 'chat', label: 'Report an issue' },
    { to: '/student/reports', icon: 'list', label: 'My reports' },
  ],
  admin: [
    { to: '/admin', icon: 'grid', label: 'Dashboard', end: true },
    { to: '/admin/issues', icon: 'list', label: 'Complaints' },
    { to: '/admin/duplicates', icon: 'layers', label: 'Similar reports' },
  ],
};

export function Brand() {
  return (
    <span className="brand">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="8" fill="currentColor" /><path d="M9 21.5V12l7-4.5 7 4.5v9.5" fill="none" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinejoin="round" /><circle cx="16" cy="17" r="2.6" fill="var(--signal)" /></svg>
      </span>
      <span className="brand__name">CampusCare<span> AI</span></span>
    </span>
  );
}

export default function Layout() {
  return <AlertsProvider><Shell /></AlertsProvider>;
}

function Shell() {
  const { user, logout } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const base = user.role === 'admin' ? '/admin/issues' : '/student/reports';

  // Global real-time notifications.
  useRealtimeEvent(['issue:created', 'issue:updated'], (issue, event) => {
    if (!issue) return;
    // Every new report reaches the admin automatically. Critical ones also raise the red banner and alarm.
    if (user.role === 'admin' && event === 'issue:created') {
      const level = issue.dispatch?.level || 'normal';
      notify({
        tone: level === 'normal' ? 'info' : 'critical',
        title: `${DISPATCH[level].short} · ${issue.ticket}`,
        body: `${issue.title} — ${issue.location}`,
        action: { label: 'Open', onClick: () => navigate(`${base}/${issue.id}`) },
        timeout: level === 'normal' ? 6000 : 12000,
      });
    }
    if (user.role === 'student' && event === 'issue:updated' && issue.reporter?.id === user.id) {
      const last = issue.timeline[issue.timeline.length - 1];
      if (last?.by !== user.name) {
        notify({
          tone: issue.status === 'resolved' ? 'success' : 'info',
          title: `${issue.ticket} · ${statusById(issue.status).label}`,
          body: last?.note || issue.title,
          action: { label: 'View', onClick: () => navigate(`${base}/${issue.id}`) },
        });
      }
    }
  });

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail__top">
          <Brand />
          <span className="rail__status">
            {user.role === 'admin' && <AlertBell />}
            <LiveDot />
          </span>
        </div>
        <nav className="rail__nav" aria-label="Main">
          {NAV[user.role].map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `navlink ${isActive ? 'is-active' : ''}`}>
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="rail__user">
          <span className="avatar">{initials(user.name)}</span>
          <span className="rail__who">
            <strong>{user.name}</strong>
            <span className="muted small">{user.role === 'admin' ? 'Administrator' : `Student${user.enrollment ? ` · ${user.enrollment}` : ''}`}</span>
          </span>
          <button className="icon-btn" onClick={() => { logout(); navigate('/login'); }} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={18} />
          </button>
        </div>
        {USE_MOCK && <p className="rail__note small">Demo mode · mock backend</p>}
      </aside>
      <main className="content" id="main">
        {user.role === 'admin' && <CriticalBanner />}
        <Outlet />
      </main>
    </div>
  );
}
