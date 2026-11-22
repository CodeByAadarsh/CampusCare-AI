import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/index.js';
import IssueRow from '../../components/IssueRow.jsx';
import Icon from '../../components/Icon.jsx';
import { EmptyState, ErrorNote, Loading } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useRealtimeEvent } from '../../realtime/RealtimeContext.jsx';
import { isOpen } from '../../lib/constants.js';
import { useAuth } from '../../context/AuthContext.jsx';

const TABS = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Resolved' },
  { id: 'all', label: 'All' },
];

export default function MyReports() {
  const { user } = useAuth();
  const [tab, setTab] = useState('open');
  const { data, error, loading, reload } = useAsync(() => api.myIssues(), []);

  useRealtimeEvent(['issue:created', 'issue:updated', 'issue:reset'], (issue) => {
    if (!issue || issue.reporter?.id === user.id || issue.affectedUsers?.includes(user.id)) reload();
  });

  const items = data?.items || [];
  const counts = { open: items.filter((i) => isOpen(i.status)).length, closed: items.filter((i) => !isOpen(i.status)).length, all: items.length };
  const visible = items.filter((i) => tab === 'all' || (tab === 'open' ? isOpen(i.status) : !isOpen(i.status)));

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="h1">My reports</h1>
          <p className="muted">Reports you submitted or joined. Status changes appear here as soon as the team updates them.</p>
        </div>
        <Link to="/student/report" className="btn btn--primary"><Icon name="plus" size={16} />New report</Link>
      </header>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
            {t.label} <span className="tabs__count">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <ErrorNote error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : visible.length ? (
        <div className="stack">
          {visible.map((i) => <IssueRow key={i.id} issue={i} to={`/student/reports/${i.id}`} />)}
        </div>
      ) : (
        <EmptyState title={tab === 'open' ? 'Nothing open right now' : 'No reports here yet'}>
          {tab === 'open' ? 'When you report something, you can follow it here until it’s fixed.' : 'Resolved reports will show up here.'}
        </EmptyState>
      )}
    </div>
  );
}
