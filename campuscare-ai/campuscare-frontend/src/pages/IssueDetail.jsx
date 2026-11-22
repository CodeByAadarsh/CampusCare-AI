import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/index.js';
import Icon from '../components/Icon.jsx';
import Timeline from '../components/Timeline.jsx';
import PriorityBreakdown from '../components/PriorityBreakdown.jsx';
import { CategoryTag, ErrorNote, FlagBadge, Loading, PriorityBadge, Segments, StatusBadge } from '../components/ui.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useRealtimeEvent } from '../realtime/RealtimeContext.jsx';
import { CATEGORIES, DEPARTMENTS, DISPATCH, categoryById, departmentById, isOpen, needsAck, statusById } from '../lib/constants.js';
import { formatDateTime, initials, pct, timeAgo } from '../lib/format.js';
import { assetUrl } from '../config.js';

export default function IssueDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const base = isAdmin ? '/admin/issues' : '/student/reports';
  const { data: issue, error, loading, reload, setData } = useAsync(() => api.getIssue(id), [id]);

  useRealtimeEvent(['issue:updated', 'issue:reset'], (p) => {
    if (!p || p.id === id || p.duplicateOf === id) reload();
  });

  if (loading && !issue) return <div className="page"><Loading label="Opening report…" /></div>;
  if (error && !issue) return <div className="page"><ErrorNote error={error} onRetry={reload} /><Link to={base} className="btn btn--ghost">Back to the list</Link></div>;

  const apply = async (fn) => { const updated = await fn(); setData({ ...issue, ...updated }); reload(); };

  return (
    <div className="page">
      <Link to={base} className="back"><Icon name="back" size={16} />{isAdmin ? 'Complaints' : 'My reports'}</Link>

      <header className={`detail-head stripe--${issue.status === 'resolved' || issue.status === 'duplicate' ? 'closed' : issue.priority.level}`}>
        <div className="row gap-sm wrap">
          <span className="mono muted">{issue.ticket}</span>
          <StatusBadge status={issue.status} />
          <PriorityBadge priority={issue.priority} />
          <CategoryTag id={issue.category} />
          <FlagBadge dispatch={issue.dispatch} />
        </div>
        <h1 className="h1">{issue.title}</h1>
        <div className="issue-row__meta">
          <span><Icon name="pin" size={14} />{issue.location}{issue.extracted?.locationSource === 'ai' && <span className="ai-read" title="Read from the description by the AI">AI</span>}</span>
          <span><Icon name="clock" size={14} />Noticed {formatDateTime(issue.occurredAt)}{issue.extracted?.whenText && <span className="muted"> (“{issue.extracted.whenText}”)</span>}</span>
          <span><Icon name="users" size={14} />{issue.affectedCount} {issue.affectedCount === 1 ? 'student' : 'students'} affected</span>
          {issue.extracted?.recurring && <span><Icon name="clock" size={14} />Keeps happening</span>}
          {isAdmin && <span><Icon name="userPlus" size={14} />Reported by {issue.reporter.name}</span>}
        </div>
      </header>

      {issue.parent && (
        <div className="notice">
          <Icon name="merge" size={18} />
          <span>This report was merged into <Link to={`${base}/${issue.parent.id}`} className="mono">{issue.parent.ticket}</Link>, which is {statusById(issue.parent.status).label.toLowerCase()}. Updates continue there.</span>
        </div>
      )}

      {isAdmin ? (
        <div className="detail-grid">
          <div className="stack-lg">
            <ManageCard issue={issue} apply={apply} />
            <section className="card">
              <h2 className="eyebrow">What the student wrote</h2>
              <p className="prose">{issue.description}</p>
              {issue.images?.length > 0 && (
                <div className="photos">{issue.images.map((src, i) => <img key={i} src={assetUrl(src)} alt={`Photo ${i + 1} attached by the reporter`} />)}</div>
              )}
            </section>
            <Comments issue={issue} apply={apply} />
            <details className="card disclosure">
              <summary className="eyebrow">Full history <span className="muted">({issue.timeline.length} updates)</span></summary>
              <Timeline entries={issue.timeline} />
            </details>
          </div>
          <div className="stack-lg">
            <AiSummary issue={issue} />
            <RelatedReports issue={issue} base={base} isAdmin apply={apply} />
          </div>
        </div>
      ) : <>
      <DispatchCard issue={issue} isAdmin={false} apply={apply} />

      <div className="detail-grid">
        <div className="stack-lg">
          <section className="card">
            <h2 className="eyebrow">Description</h2>
            <p className="prose">{issue.description}</p>
            {issue.images?.length > 0 && (
              <div className="photos">{issue.images.map((src, i) => <img key={i} src={assetUrl(src)} alt={`Photo ${i + 1} attached by the reporter`} />)}</div>
            )}
          </section>

          <section className="card">
            <h2 className="eyebrow">Progress</h2>
            <Timeline entries={issue.timeline} />
          </section>

          <Comments issue={issue} apply={apply} />
        </div>

        <div className="stack-lg">
          <section className="card">
            <h2 className="eyebrow"><Icon name="cpu" size={14} />AI triage</h2>
            <dl className="kv kv--stack">
              <div><dt>Type</dt><dd><CategoryTag id={issue.ai.category} /> <span className="muted small">{pct(issue.ai.confidence)}</span></dd></div>
              <div><dt>Severity</dt><dd><Segments value={issue.ai.severity} tone={issue.ai.severity >= 4 ? 'hot' : undefined} /> <span className="mono small">{issue.ai.severity}/5</span></dd></div>
              <div><dt>Urgency</dt><dd><Segments value={issue.ai.urgency} tone={issue.ai.urgency >= 4 ? 'hot' : undefined} /> <span className="mono small">{issue.ai.urgency}/5</span></dd></div>
              <div><dt>Safety risk</dt><dd className="mono">{pct(issue.ai.safetyImpact)}</dd></div>
            </dl>
            {issue.ai.signals?.length > 0 && (
              <div className="signals"><div className="row gap-xs wrap">{issue.ai.signals.map((s) => <span key={s} className="signal">{s}</span>)}</div></div>
            )}
            <PriorityBreakdown priority={issue.priority} />
          </section>

          <ReadByAI issue={issue} canEdit={issue.reporter.id === user.id && isOpen(issue.status)} apply={apply} />

          <section className="card">
            <h2 className="eyebrow">Handled by</h2>
            <p className="strong">{departmentById(issue.department).name}</p>
            <p className="muted">{issue.assignee || 'Not assigned to a person yet'}</p>
            {issue.department !== categoryById(issue.category).department && <p className="small muted">Re-routed by an administrator.</p>}
          </section>

          <RelatedReports issue={issue} base={base} isAdmin={false} apply={apply} />
        </div>
      </div>
      </>}
    </div>
  );
}

const STAGES = ['Received', 'With a team', 'Resolved'];
const stageOf = (status) => (['new', 'pending'].includes(status) ? 0 : ['assigned', 'in_progress'].includes(status) ? 1 : 2);

/**
 * Everything an admin does with a complaint, in one card:
 *   Received    -> pick the team (the AI's choice is preselected), optionally a person -> "Assign"
 *   With a team -> "Mark resolved" (optionally "Work started", or change the team)
 *   Resolved    -> "Reopen"
 * An optional message to the student travels with whichever button is pressed.
 */
function ManageCard({ issue, apply }) {
  const { notify } = useToast();
  const [dept, setDept] = useState(issue.department);
  const [person, setPerson] = useState(issue.assignee || '');
  const [note, setNote] = useState('');
  const [changeTeam, setChangeTeam] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { setDept(issue.department); setPerson(issue.assignee || ''); setChangeTeam(false); }, [issue.status, issue.department, issue.assignee]);
  if (issue.status === 'duplicate') return null;

  const stage = stageOf(issue.status);
  const aiTeam = categoryById(issue.category).department;
  const teamChanged = dept !== issue.department || person.trim() !== (issue.assignee || '');
  const d = issue.dispatch;
  const waiting = needsAck(issue);
  const message = note.trim() || undefined;

  const run = async (key, fn, done) => {
    setBusy(key); setError(null);
    try { await apply(fn); notify({ tone: 'success', title: done }); setNote(''); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const assign = () => run('assign', () => api.assignIssue(issue.id, { department: dept, assignee: person.trim() || undefined, note: message }),
    `${issue.ticket} ${stage === 0 ? 'assigned to' : 'moved to'} ${departmentById(dept).short}`);
  const setStatus = (status, done) => run(status, () => api.updateStatus(issue.id, { status, note: message }), done);

  const teamFields = (
    <div className="form-grid form-grid--pair manage__team">
      <label className="field">
        <span>Team {dept === aiTeam && <span className="muted">(picked by the AI)</span>}</span>
        <select id="assign-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
          {Object.values(DEPARTMENTS).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Person <span className="muted">(optional)</span></span>
        <input id="assign-person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="e.g. Ramesh (electrician)" maxLength={80} />
      </label>
    </div>
  );

  return (
    <section className="card manage" aria-label="Manage this complaint">
      <ol className="steps" aria-label="Progress">
        {STAGES.map((label, i) => (
          <li key={label} className={i < stage || stage === 2 ? 'is-done' : i === stage ? 'is-current' : ''} aria-current={i === stage ? 'step' : undefined}>
            <span className="steps__dot">{i < stage || stage === 2 ? <Icon name="check" size={12} /> : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {d && d.level !== 'normal' && (
        <p className={`manage__flag manage__flag--${d.level}`}>
          <Icon name="flag" size={14} />
          <span><strong>Flagged {DISPATCH[d.level].label} by the AI</strong> · {d.reasons.join(', ')}.{' '}
            {waiting ? 'Not acknowledged yet. Assigning it acknowledges the alert.' : d.acknowledgedAt ? `Acknowledged by ${d.acknowledgedBy || 'the administration'} ${timeAgo(d.acknowledgedAt)}.` : ''}
          </span>
        </p>
      )}

      {stage === 0 && teamFields}

      {stage === 1 && (
        <div className="manage__now">
          <p>With <strong>{departmentById(issue.department).name}</strong>{issue.assignee && <> · {issue.assignee}</>}{issue.status === 'in_progress' && <span className="muted"> · work has started</span>}</p>
          <button className="link-btn small" onClick={() => setChangeTeam((c) => !c)} aria-expanded={changeTeam}><Icon name="edit" size={14} />{changeTeam ? 'Keep the current team' : 'Change team or person'}</button>
        </div>
      )}
      {stage === 1 && changeTeam && teamFields}

      {stage === 2 && <p className="manage__now">Resolved {timeAgo(issue.updatedAt)}. Reopen it if the problem is back.</p>}

      <label className="field">
        <span>Message to the student <span className="muted">(optional)</span></span>
        <input id="status-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={stage === 2 ? 'e.g. Reopened, the leak is back' : 'e.g. Electrician will visit at 3 pm'} maxLength={500} />
      </label>

      <div className="manage__actions">
        {stage === 0 && (
          <>
            <button className="btn btn--primary" disabled={!!busy} onClick={assign}>{busy === 'assign' ? 'Saving…' : `Assign to ${departmentById(dept).short}`}</button>
            {waiting && <button className="link-btn" disabled={!!busy} onClick={() => run('ack', () => api.acknowledgeIssue(issue.id, { note: message }), `${issue.ticket} acknowledged`)}>Only acknowledge for now</button>}
          </>
        )}
        {stage === 1 && (
          <>
            {changeTeam && teamChanged
              ? <button className="btn btn--primary" disabled={!!busy} onClick={assign}>{busy === 'assign' ? 'Saving…' : 'Save team change'}</button>
              : <button className="btn btn--primary" disabled={!!busy} onClick={() => setStatus('resolved', `${issue.ticket} resolved`)}><Icon name="check" size={16} />{busy === 'resolved' ? 'Saving…' : 'Mark resolved'}</button>}
            {issue.status === 'assigned' && !changeTeam && (
              <button className="btn btn--ghost" disabled={!!busy} onClick={() => setStatus('in_progress', 'Marked as work started')}>{busy === 'in_progress' ? 'Saving…' : 'Work started'}</button>
            )}
          </>
        )}
        {stage === 2 && (
          <button className="btn btn--ghost" disabled={!!busy} onClick={() => setStatus('assigned', `${issue.ticket} reopened`)}>{busy === 'assigned' ? 'Saving…' : 'Reopen'}</button>
        )}
      </div>
      <ErrorNote error={error} />
    </section>
  );
}

/** Admin view of the AI's reading: type, scores, the words it reacted to, and how the priority was computed. */
function AiSummary({ issue }) {
  return (
    <section className="card">
      <h2 className="eyebrow"><Icon name="cpu" size={14} />What the AI found</h2>
      <dl className="kv kv--stack">
        <div><dt>Type</dt><dd><CategoryTag id={issue.ai.category} /> <span className="muted small">{pct(issue.ai.confidence)} sure</span></dd></div>
        <div><dt>Severity</dt><dd><Segments value={issue.ai.severity} tone={issue.ai.severity >= 4 ? 'hot' : undefined} /> <span className="mono small">{issue.ai.severity}/5</span></dd></div>
        <div><dt>Urgency</dt><dd><Segments value={issue.ai.urgency} tone={issue.ai.urgency >= 4 ? 'hot' : undefined} /> <span className="mono small">{issue.ai.urgency}/5</span></dd></div>
        <div><dt>Safety risk</dt><dd className="mono">{pct(issue.ai.safetyImpact)}</dd></div>
      </dl>
      {issue.ai.signals?.length > 0 && (
        <div className="signals"><div className="row gap-xs wrap">{issue.ai.signals.map((x) => <span key={x} className="signal">{x}</span>)}</div></div>
      )}
      <details className="disclosure disclosure--inline">
        <summary className="small">How the priority score ({issue.priority.score}) was worked out</summary>
        <PriorityBreakdown priority={issue.priority} />
      </details>
    </section>
  );
}

function Comments({ issue, apply }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { await apply(() => api.addComment(issue.id, { text })); setText(''); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <section className="card">
      <h2 className="eyebrow">Messages</h2>
      {issue.comments.length ? (
        <ul className="comments">
          {issue.comments.map((c) => (
            <li key={c.id} className={c.role === 'admin' ? 'is-staff' : ''}>
              <span className="avatar avatar--sm">{initials(c.author)}</span>
              <div>
                <div className="row gap-sm"><strong>{c.author}</strong>{c.role === 'admin' && <span className="tag tag--dept">Staff</span>}<span className="muted small">{timeAgo(c.at)}</span></div>
                <p>{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="muted">No messages yet. Use this to add details or ask for an update.</p>}
      <form className="comment-form" onSubmit={send}>
        <input id="comment-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" aria-label="Message" />
        <button className="btn btn--primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
      <ErrorNote error={error} />
    </section>
  );
}

function RelatedReports({ issue, base, isAdmin, apply }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(null);
  const merge = async (r) => {
    setBusy(r.id);
    try {
      await apply(() => api.mergeIssue(issue.id, { into: r.id }));
      notify({ tone: 'success', title: `${issue.ticket} merged into ${r.ticket}` });
    } catch (e) {
      notify({ tone: 'critical', title: 'Could not merge', body: e.message });
    } finally { setBusy(null); }
  };

  if (!issue.merged?.length && !issue.related?.length) return null;
  return (
    <section className="card">
      <h2 className="eyebrow"><Icon name="link" size={14} />Same or similar reports</h2>
      {issue.merged?.length > 0 && (
        <>
          <p className="small muted">Merged into this report</p>
          <ul className="mini-list">
            {issue.merged.map((m) => (
              <li key={m.id}><Link to={`${base}/${m.id}`}><span className="mono">{m.ticket}</span> {m.title}</Link><span className="muted small">{m.reporter.name}</span></li>
            ))}
          </ul>
        </>
      )}
      {issue.related?.length > 0 && (
        <>
          <p className="small muted">Possibly the same problem</p>
          <ul className="mini-list">
            {issue.related.map((r) => (
              <li key={r.id}>
                {isAdmin ? <Link to={`${base}/${r.id}`}><span className="mono">{r.ticket}</span> {r.title}</Link> : <span><span className="mono">{r.ticket}</span> {r.title}</span>}
                <span className="row gap-sm">
                  <span className="match">{pct(r.similarity)} match</span>
                  {isAdmin && issue.status !== 'duplicate' && (
                    <button className="link-btn" disabled={busy} onClick={() => merge(r)}>{busy === r.id ? 'Merging…' : 'Same problem, merge'}</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** How the report reached the administration: sent automatically, with the AI's flag and acknowledgement status. */
function DispatchCard({ issue, isAdmin, apply }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const d = issue.dispatch;
  if (!d) return null;
  const waiting = needsAck(issue);
  const acknowledge = async () => {
    setBusy(true);
    try { await apply(() => api.acknowledgeIssue(issue.id)); notify({ tone: 'success', title: `${issue.ticket} acknowledged` }); }
    catch (e) { notify({ tone: 'critical', title: 'Could not acknowledge', body: e.message }); }
    finally { setBusy(false); }
  };
  return (
    <section className={`dispatch dispatch--${d.level}`} aria-label="Automatic dispatch">
      <Icon name={d.level === 'normal' ? 'send' : 'flag'} size={20} />
      <div className="dispatch__text">
        <strong>
          {d.level === 'normal' ? 'Sent to the administration automatically' : `Flagged ${DISPATCH[d.level].label} and sent to the administration automatically`}
          {' '}<span className="muted small">· {formatDateTime(d.sentAt || issue.createdAt)}</span>
        </strong>
        <span className="small">Why: {d.reasons.join(', ')}.{' '}
          {d.acknowledgedAt
            ? <>Acknowledged by {d.acknowledgedBy || 'the administration'} {timeAgo(d.acknowledgedAt)}.</>
            : d.level === 'normal' ? <>In the queue for {departmentById(issue.department).name}.</>
            : <>{isAdmin ? 'Waiting for an administrator to acknowledge.' : 'Administrators have been alerted.'}{d.escalations > 0 && ` Reminder sent ${d.escalations}×.`}</>}
        </span>
      </div>
      {isAdmin && waiting && <button className="btn btn--primary btn--sm" onClick={acknowledge} disabled={busy}>{busy ? 'Saving…' : 'Acknowledge'}</button>}
    </section>
  );
}

/** What the AI read from the description; the reporter can correct the place or the type. */
function ReadByAI({ issue, canEdit, apply }) {
  const { notify } = useToast();
  const ex = issue.extracted;
  const missingPlace = ex?.missing?.includes('location');
  const [editing, setEditing] = useState(false);
  const [location, setLocation] = useState(missingPlace ? '' : issue.location);
  const [category, setCategory] = useState(issue.category);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (missingPlace && canEdit) setEditing(true); }, [missingPlace, canEdit]);
  if (!ex) return null;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apply(() => api.updateDetails(issue.id, { location: location.trim() || undefined, category }));
      notify({ tone: 'success', title: 'Details updated', body: 'The administration sees the change straight away.' });
      setEditing(false);
    } catch (err) {
      notify({ tone: 'critical', title: 'Could not save', body: err.message });
    } finally { setBusy(false); }
  };

  const source = { ai: 'read by the AI', student: 'given by the student', admin: 'set by an administrator', none: 'not found' }[ex.locationSource] || '';
  return (
    <section className="card">
      <h2 className="eyebrow"><Icon name="cpu" size={14} />Read from the description</h2>
      <dl className="kv kv--stack">
        <div><dt>Place</dt><dd>{missingPlace ? <span className="warn-text">Not mentioned</span> : issue.location} <span className="muted small">{!missingPlace && source}</span></dd></div>
        <div><dt>Noticed</dt><dd>{ex.whenText ? <>“{ex.whenText}”</> : <span className="muted">Not mentioned, time of report used</span>}{ex.recurring && <span className="muted small"> · keeps happening</span>}</dd></div>
        <div><dt>People affected</dt><dd>{ex.peopleCount ? `about ${ex.peopleCount}` : ex.manyAffected ? 'many, per the description' : <span className="muted">Not mentioned</span>}</dd></div>
      </dl>
      {canEdit && !editing && (
        <button className="link-btn small" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Something wrong? Correct the details</button>
      )}
      {canEdit && editing && (
        <form className="details-form" onSubmit={save}>
          {missingPlace && <p className="small warn-text">The AI could not find where this is. Add the place so the team can find it.</p>}
          <label className="field">
            <span>Place</span>
            <input id="details-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Block C, 3rd floor, room 312" maxLength={160} />
          </label>
          <label className="field">
            <span>Type of issue</span>
            <select id="details-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <div className="row gap-sm">
            <button className="btn btn--primary btn--sm" disabled={busy || (!location.trim() && category === issue.category)}>{busy ? 'Saving…' : 'Save details'}</button>
            {!missingPlace && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </form>
      )}
    </section>
  );
}
