import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/index.js';
import Icon from '../../components/Icon.jsx';
import NextStepButton from '../../components/NextStep.jsx';
import IssueRow from '../../components/IssueRow.jsx';
import { EmptyState, ErrorNote, FlagBadge, Loading, PriorityBadge, StatusBadge } from '../../components/ui.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useRealtimeEvent } from '../../realtime/RealtimeContext.jsx';
import { CATEGORIES, DEPARTMENTS, PRIORITY_LEVELS, departmentById, statusById } from '../../lib/constants.js';
import { timeAgo } from '../../lib/format.js';

// Main tabs. The dashboard tiles can also open narrower views (flagged, new, pending, high), shown as a chip.
const TABS = [
  { id: 'open', label: 'All open' },
  { id: 'todo', label: 'To assign' },
  { id: 'team', label: 'With a team' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'Everything' },
];
const NARROW = { flagged: 'Flagged by AI', high: 'High priority', new: 'New', pending: 'Pending', in_progress: 'In progress', assigned: 'Assigned', duplicate: 'Merged' };

export default function IssueQueue() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = {
    status: params.get('status') || 'open',
    category: params.get('category') || '',
    department: params.get('department') || '',
    level: params.get('level') || '',
    sort: params.get('sort') || 'priority',
    search: params.get('search') || '',
  };
  const [search, setSearch] = useState(q.search);
  const extraOn = Boolean(q.category || q.department || q.level || q.sort !== 'priority');
  const [moreOpen, setMoreOpen] = useState(extraOn);
  const key = JSON.stringify(q);

  const { data, error, loading, reload } = useAsync(() => api.listIssues(q), [key]);
  useRealtimeEvent(['issue:created', 'issue:updated', 'issue:reset'], () => reload());

  // Debounced search box -> URL.
  useEffect(() => {
    if (search === q.search) return undefined;
    const t = setTimeout(() => set('search', search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function set(name, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    setParams(next, { replace: true });
  }

  const narrow = NARROW[q.status];

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="h1">Complaints</h1>
          <p className="muted">{data ? `${data.total} ${data.total === 1 ? 'complaint' : 'complaints'}` : 'Loading'} · {q.sort === 'priority' ? 'most urgent first' : q.sort === 'newest' ? 'newest first' : 'oldest first'}</p>
        </div>
      </header>

      <div className="queue-bar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={q.status === t.id} className={q.status === t.id ? 'is-on' : ''} onClick={() => set('status', t.id === 'open' ? '' : t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="queue-bar__tools">
          {narrow && (
            <span className="chip-filter">Showing: {narrow}
              <button onClick={() => set('status', '')} aria-label={`Stop showing only ${narrow}`}><Icon name="x" size={12} /></button>
            </span>
          )}
          <label className="search">
            <Icon name="search" size={16} />
            <input id="q-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, place or ticket" aria-label="Search complaints" />
          </label>
          <button className={`btn btn--ghost btn--sm ${extraOn ? 'is-on' : ''}`} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
            <Icon name="list" size={14} />Filters{extraOn ? ' · on' : ''}
          </button>
        </div>
      </div>

      {moreOpen && (
        <div className="filters filters--more">
          <select id="q-department" aria-label="Team" value={q.department} onChange={(e) => set('department', e.target.value)}>
            <option value="">Any team</option>
            {Object.values(DEPARTMENTS).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select id="q-category" aria-label="Type" value={q.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">Any type</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select id="q-level" aria-label="Priority" value={q.level} onChange={(e) => set('level', e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITY_LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <select id="q-sort" aria-label="Sort" value={q.sort} onChange={(e) => set('sort', e.target.value === 'priority' ? '' : e.target.value)}>
            <option value="priority">Most urgent first</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          {(extraOn || q.search) && <button className="link-btn" onClick={() => { setSearch(''); setParams(q.status !== 'open' ? { status: q.status } : {}, { replace: true }); }}>Clear filters</button>}
        </div>
      )}

      <ErrorNote error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data?.items.length ? (<>
        {/* phones: cards with the same one-click next step */}
        <div className="queue-cards stack stack--tight">
          {data.items.map((i) => <IssueRow key={i.id} issue={i} to={`/admin/issues/${i.id}`} actions={<NextStepButton issue={i} onDone={reload} />} />)}
        </div>
        <div className="table-wrap card card--flush queue-table">
          <table className="table table--queue">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Complaint</th>
                <th>Team</th>
                <th>Status</th>
                <th>Reported</th>
                <th className="th-action"><span className="sr-only">Next step</span></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const closed = ['resolved', 'duplicate'].includes(i.status);
                return (
                  <tr key={i.id} onClick={() => navigate(`/admin/issues/${i.id}`)} className={`stripe--${closed ? 'closed' : i.priority.level}`}>
                    <td><PriorityBadge priority={i.priority} compact /></td>
                    <td className="cell-issue">
                      <Link to={`/admin/issues/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.title}</Link>
                      <span className="muted small"><span className="mono">{i.ticket}</span> · {i.location}{!closed && i.dispatch?.level !== 'normal' && <> · <FlagBadge dispatch={i.dispatch} /></>}</span>
                    </td>
                    <td>{departmentById(i.department).short}{i.assignee && <span className="muted small block">{i.assignee}</span>}</td>
                    <td><StatusBadge status={i.status} /></td>
                    <td className="muted nowrap">{timeAgo(i.createdAt)}</td>
                    <td className="cell-action">{closed ? <span className="muted small">{statusById(i.status).label}</span> : <NextStepButton issue={i} onDone={reload} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>) : (
        <EmptyState icon="search" title="No complaints here">Try another tab or clear the search.</EmptyState>
      )}
    </div>
  );
}
