import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/index.js';
import Icon from '../../components/Icon.jsx';
import { EmptyState, ErrorNote, Loading, PriorityBadge, StatusBadge } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useRealtimeEvent } from '../../realtime/RealtimeContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { DUPLICATE_THRESHOLD } from '../../lib/triage.js';
import { pct, timeAgo } from '../../lib/format.js';

function Mini({ issue, label }) {
  return (
    <Link to={`/admin/issues/${issue.id}`} className="mini">
      {label && <span className="eyebrow">{label}</span>}
      <span className="row gap-sm wrap">
        <span className="mono muted">{issue.ticket}</span>
        <StatusBadge status={issue.status} />
        <PriorityBadge priority={issue.priority} compact />
      </span>
      <strong>{issue.title}</strong>
      <span className="muted small"><Icon name="pin" size={12} /> {issue.location} · {issue.reporter.name} · {timeAgo(issue.createdAt)}</span>
    </Link>
  );
}

export default function Duplicates() {
  const { notify } = useToast();
  const [busy, setBusy] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const { data, error, loading, reload } = useAsync(() => api.duplicateGroups(), []);
  useRealtimeEvent(['issue:created', 'issue:updated', 'issue:reset'], () => reload());

  const merge = async (s) => {
    const key = `${s.primary.id}|${s.candidate.id}`;
    setBusy(key);
    try {
      const primary = await api.mergeIssue(s.candidate.id, { into: s.primary.id });
      notify({ tone: 'success', title: `${s.candidate.ticket} merged into ${s.primary.ticket}`, body: `${primary.affectedCount} students affected · priority ${primary.priority.score}` });
      reload();
    } catch (e) {
      notify({ tone: 'critical', title: 'Could not merge', body: e.message });
    } finally { setBusy(null); }
  };

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error && !data) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;

  const suggestions = data.suggestions.filter((s) => !dismissed.has(`${s.primary.id}|${s.candidate.id}`));

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="h1">Similar reports</h1>
          <p className="muted">
            The AI pairs up open complaints that look like the same problem. Merge keeps the earlier ticket, counts every student on it and raises its priority.
          </p>
        </div>
      </header>

      <section className="stack-lg">
        <h2 className="h3">Check these <span className="count">{suggestions.length}</span></h2>
        {suggestions.length ? suggestions.map((s) => {
          const key = `${s.primary.id}|${s.candidate.id}`;
          const strong = s.similarity >= DUPLICATE_THRESHOLD;
          return (
            <article key={key} className="pair card">
              <Mini issue={s.primary} label="Earlier report" />
              <div className="pair__mid">
                <span className={`match ${strong ? 'match--strong' : ''}`}>{pct(s.similarity)} match</span>
                <span className="muted small">{strong ? 'Likely the same problem' : 'Possibly related'}</span>
              </div>
              <Mini issue={s.candidate} label="Later report" />
              <div className="pair__actions">
                <button className="btn btn--primary btn--sm" disabled={busy === key} onClick={() => merge(s)}>
                  <Icon name="merge" size={16} />{busy === key ? 'Merging…' : 'Same problem, merge'}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setDismissed((d) => new Set(d).add(key))}>Not the same</button>
              </div>
            </article>
          );
        }) : <EmptyState icon="check" title="No suspected duplicates">New matches appear here as reports arrive.</EmptyState>}
      </section>

      <section className="stack-lg section-gap">
        <h2 className="h3">Already merged <span className="count">{data.confirmed.length}</span></h2>
        {data.confirmed.length ? data.confirmed.map((g) => (
          <article key={g.primary.id} className="group card">
            <Mini issue={g.primary} label={`Primary · ${g.primary.affectedCount} students`} />
            <ul className="mini-list">
              {g.members.map((m) => (
                <li key={m.id}>
                  <Link to={`/admin/issues/${m.id}`}><span className="mono">{m.ticket}</span> {m.title}</Link>
                  <span className="muted small">{m.reporter.name} · {timeAgo(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          </article>
        )) : <p className="muted">Nothing merged yet.</p>}
      </section>
    </div>
  );
}
