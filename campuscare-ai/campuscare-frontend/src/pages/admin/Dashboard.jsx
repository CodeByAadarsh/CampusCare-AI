import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { demo } from '../../api/index.js';
import Icon from '../../components/Icon.jsx';
import IssueRow from '../../components/IssueRow.jsx';
import NextStepButton from '../../components/NextStep.jsx';
import { EmptyState, ErrorNote, Loading } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useRealtimeEvent } from '../../realtime/RealtimeContext.jsx';
import { needsAck } from '../../lib/constants.js';

const TILES = [
  { key: 'flagged', label: 'Flagged by AI', hint: 'Waiting for acknowledgement', filter: 'flagged', hot: true },
  { key: 'new', label: 'New', hint: 'Not looked at yet', filter: 'new' },
  { key: 'pending', label: 'Pending', hint: 'Acknowledged, not assigned', filter: 'pending' },
  { key: 'high', label: 'High priority', hint: 'Critical or high, still open', filter: 'high', hot: true },
  { key: 'assigned', label: 'With a team', hint: 'Assigned or in progress', filter: 'team' },
  { key: 'resolved', label: 'Resolved', hint: 'In the last 7 days', filter: 'resolved' },
];

// The whole admin job in two lists: hand new complaints to a team, then close them when fixed.
const TABS = [
  { id: 'todo', label: 'To assign', statuses: ['new', 'pending'], empty: 'Every complaint has been handed to a team.' },
  { id: 'team', label: 'With a team', statuses: ['assigned', 'in_progress'], empty: 'No team is working on anything right now.' },
];
const SHOW = 10;

export default function Dashboard() {
  const [tab, setTab] = useState('todo');
  const [fresh, setFresh] = useState(() => new Set());
  const freshTimer = useRef();

  const { data, error, loading, reload } = useAsync(async () => {
    const [stats, list] = await Promise.all([api.stats(), api.listIssues({ status: 'open', sort: 'priority' })]);
    return { stats, issues: list.items };
  }, []);

  useRealtimeEvent(['issue:created', 'issue:updated', 'issue:reset'], (issue) => {
    if (issue) {
      setFresh((s) => new Set(s).add(issue.id));
      clearTimeout(freshTimer.current);
      freshTimer.current = setTimeout(() => setFresh(new Set()), 4000);
    }
    reload();
  });

  if (loading && !data) return <div className="page"><Loading label="Loading the dashboard…" /></div>;
  if (error && !data) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;

  const { stats, issues } = data;
  const lists = Object.fromEntries(TABS.map((t) => [t.id, issues
    .filter((i) => t.statuses.includes(i.status))
    // flagged reports nobody has acknowledged go first, then by priority score
    .sort((a, b) => (needsAck(b) - needsAck(a)) || b.priority.score - a.priority.score)]));
  const current = TABS.find((t) => t.id === tab);
  const list = lists[tab];

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="h1">Dashboard</h1>
          <p className="muted">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · open reports ranked by priority score
            {stats.avgResolutionHours != null && ` · average time to resolve ${stats.avgResolutionHours} h`}
          </p>
        </div>
        {demo && (
          <button className="btn btn--ghost btn--sm" onClick={() => demo.simulateIncoming()} title="Demo mode: inject a report as if a student just sent it">
            <Icon name="plus" size={16} />Simulate a student report
          </button>
        )}
      </header>

      <div className="tiles">
        {TILES.map((t) => (
          <Link key={t.key} to={`/admin/issues?status=${t.filter}`} className={`tile ${t.hot && stats.counts[t.key] ? 'tile--hot' : ''}`}>
            <span className="tile__label">{t.label}</span>
            <span className="tile__value">{stats.counts[t.key]}</span>
            <span className="tile__hint">{t.hint}</span>
          </Link>
        ))}
      </div>

      <section className="card card--flush worklist" aria-label="Open complaints">
        <div className="worklist__head">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
                {t.label}<span className="tabs__count">{lists[t.id].length}</span>
              </button>
            ))}
          </div>
          <p className="small muted worklist__hint">
            {tab === 'todo'
              ? 'Assign sends the complaint to the team the AI picked. Use the arrow to pick another team.'
              : 'Mark resolved once the team has fixed it. The student is told automatically.'}
          </p>
        </div>
        {list.length ? (
          <div className="stack stack--tight worklist__rows">
            {list.slice(0, SHOW).map((i) => (
              <IssueRow key={i.id} issue={i} to={`/admin/issues/${i.id}`} fresh={fresh.has(i.id)}
                actions={<NextStepButton issue={i} onDone={reload} />} />
            ))}
          </div>
        ) : <EmptyState icon="check" title="Nothing here">{current.empty}</EmptyState>}
        {list.length > SHOW && (
          <Link to={`/admin/issues?status=${tab}`} className="link-btn worklist__more">See all {list.length} <Icon name="chevron" size={14} /></Link>
        )}
      </section>
    </div>
  );
}
