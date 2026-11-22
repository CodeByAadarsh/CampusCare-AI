import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/index.js';
import Icon from '../../components/Icon.jsx';
import PriorityBreakdown from '../../components/PriorityBreakdown.jsx';
import { CategoryTag, ErrorNote, FlagBadge, PriorityBadge, Segments } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { COMMON_LOCATIONS, DISPATCH, categoryById, departmentById } from '../../lib/constants.js';
import { fileToDataUrl, formatDateTime, pct } from '../../lib/format.js';

let uid = 0;
const msg = (from, content) => ({ id: ++uid, from, content });

/**
 * One-step reporting. The student describes the problem once (photos optional) and sends it.
 * The AI reads the type, place, time noticed and urgency from the text, scores it and sends it
 * straight to the administration, flagging it critical or high when it is serious.
 * The only follow-up question is the place, and only when the description doesn't mention one.
 */
export default function ReportChat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = user.name.split(' ')[0];
  const greeting = (
    <>Hi {firstName}. Describe the problem in your own words: what’s wrong, where, and since when.
      I’ll work out the rest and send it straight to the administration.</>
  );

  const [messages, setMessages] = useState(() => [msg('bot', greeting)]);
  const [phase, setPhase] = useState('describe'); // describe | sending | place | sent
  const [input, setInput] = useState('');
  const [photos, setPhotos] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [issue, setIssue] = useState(null);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState(null);
  const threadRef = useRef(null);
  const fileRef = useRef(null);

  const say = (from, content) => setMessages((m) => [...m, msg(from, content)]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, phase]);

  // Live preview: what the AI reads while the student is still typing.
  useEffect(() => {
    if (phase !== 'describe' || input.trim().length < 15) return undefined;
    const t = setTimeout(() => { api.analyzeDraft({ description: input }).then(setAnalysis).catch(() => {}); }, 650);
    return () => clearTimeout(t);
  }, [input, phase]);

  const addPhotos = async (files) => {
    const list = Array.from(files || []).slice(0, 3 - photos.length);
    if (!list.length) return;
    const urls = await Promise.all(list.map((f) => fileToDataUrl(f)));
    setPhotos((p) => [...p, ...urls].slice(0, 3));
    if (fileRef.current) fileRef.current.value = '';
  };

  const send = async () => {
    const text = input.trim();
    if (text.length < 10) { setError(new Error('Add a few more words so the team knows what to look for.')); return; }
    setError(null);
    const images = photos;
    say('me', (
      <>
        {text}
        {images.length > 0 && <span className="chat-photos">{images.map((src, i) => <img key={i} src={src} alt={`Attached photo ${i + 1}`} />)}</span>}
      </>
    ));
    setInput('');
    setPhotos([]);
    setPhase('sending');
    setTyping(true);
    try {
      const created = await api.createIssue({ description: text, images });
      setTyping(false);
      setIssue(created);
      say('bot', <SentCard issue={created} />);
      if (created.extracted?.missing?.includes('location')) {
        say('bot', <>One thing I couldn’t find: <strong>where is it?</strong> Pick a place or type the building, floor and room, and I’ll add it to {created.ticket}.</>);
        setPhase('place');
      } else {
        setPhase('sent');
      }
    } catch (e) {
      setTyping(false);
      setError(e);
      setInput(text);
      setPhotos(images);
      setPhase('describe');
    }
  };

  const addPlace = async (place) => {
    const where = place.trim();
    if (!where) return;
    say('me', where);
    setInput('');
    setPhase('sending');
    setTyping(true);
    try {
      const updated = await api.updateDetails(issue.id, { location: where });
      setTyping(false);
      setIssue(updated);
      say('bot', <>Added <strong>{updated.location}</strong> to <span className="mono">{updated.ticket}</span>. The administration sees it straight away.</>);
      setPhase('sent');
    } catch (e) {
      setTyping(false);
      setError(e);
      setPhase('place');
    }
  };

  const restart = () => {
    setMessages([msg('bot', 'New report. What’s the problem, where is it, and since when?')]);
    setAnalysis(null);
    setIssue(null);
    setError(null);
    setInput('');
    setPhotos([]);
    setPhase('describe');
  };

  const dock = () => {
    if (phase === 'place') {
      return (
        <div className="chips">
          {COMMON_LOCATIONS.map((l) => <button key={l} className="chip" onClick={() => addPlace(l)}><Icon name="pin" size={14} />{l}</button>)}
        </div>
      );
    }
    if (phase === 'sent') {
      return (
        <div className="chips">
          <button className="chip chip--primary" onClick={() => navigate(`/student/reports/${issue.id}`)}><Icon name="activity" size={14} />Track {issue.ticket}</button>
          <button className="chip" onClick={restart}><Icon name="plus" size={14} />Report another issue</button>
          <button className="chip" onClick={() => navigate('/student/reports')}><Icon name="list" size={14} />My reports</button>
        </div>
      );
    }
    return null;
  };

  const writing = phase === 'describe' || phase === 'place';

  return (
    <div className="report">
      <section className="chat card">
        <header className="chat__head">
          <div>
            <h1 className="h2">Report an issue</h1>
            <p className="muted small">Describe it once. The AI reads the details and sends it to the administration. Your name is visible only to them.</p>
          </div>
          {phase === 'sent' && <button className="btn btn--ghost btn--sm" onClick={restart}>New report</button>}
        </header>

        <div className="chat__thread" ref={threadRef}>
          {messages.map((m) => (
            <div key={m.id} className={`bubble bubble--${m.from}`}>
              {m.from === 'bot' && <span className="bubble__avatar" aria-hidden="true"><Icon name="cpu" size={14} /></span>}
              <div className="bubble__body">{m.content}</div>
            </div>
          ))}
          {typing && (
            <div className="bubble bubble--bot">
              <span className="bubble__avatar" aria-hidden="true"><Icon name="cpu" size={14} /></span>
              <div className="bubble__body typing" aria-label="CampusCare is analysing your report"><span /><span /><span /></div>
            </div>
          )}
          {!typing && dock() && <div className="chat__dock">{dock()}</div>}
        </div>

        <ErrorNote error={error} />

        {phase === 'describe' && photos.length > 0 && (
          <div className="attach-strip">
            {photos.map((src, i) => (
              <span key={i} className="attach-strip__item">
                <img src={src} alt={`Photo ${i + 1} to send`} />
                <button type="button" className="attach-strip__remove" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
        )}

        <form className="chat__input" onSubmit={(e) => { e.preventDefault(); phase === 'place' ? addPlace(input) : send(); }}>
          {phase === 'describe' && (
            <>
              <button type="button" className="btn btn--ghost btn--icon" onClick={() => fileRef.current?.click()} disabled={photos.length >= 3}
                aria-label="Attach photos (up to 3)" title="Attach photos (up to 3)">
                <Icon name="camera" size={18} />
              </button>
              <input ref={fileRef} id="report-photos" type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
            </>
          )}
          <textarea
            id="report-text"
            rows={phase === 'describe' ? 3 : 1}
            value={input}
            disabled={!writing}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); }
            }}
            placeholder={
              phase === 'describe' ? 'e.g. Water is leaking from the ceiling outside room 204 in Block B since morning, the floor is slippery'
                : phase === 'place' ? 'Type the place, e.g. Block C, 3rd floor, room 312'
                : phase === 'sending' ? 'Sending…'
                : 'Sent. Start a new report with the button above.'
            }
          />
          <button className="btn btn--primary btn--icon" disabled={!writing || !input.trim()} aria-label={phase === 'place' ? 'Add place' : 'Send report'}>
            <Icon name="send" size={18} />
          </button>
        </form>
      </section>

      <AnalysisPanel analysis={analysis} issue={issue} live={phase === 'describe'} />
    </div>
  );
}

/** Confirmation in the chat: ticket, how it was sent, and every detail the AI read. */
function SentCard({ issue }) {
  const d = issue.dispatch || { level: 'normal', reasons: [] };
  const ex = issue.extracted || {};
  const dup = issue.possibleDuplicates?.[0];
  const heading = d.level === 'critical' ? 'Sent as a critical alert'
    : d.level === 'high' ? 'Sent and flagged as high priority'
    : 'Sent to the administration';
  return (
    <div className={`sent-card sent-card--${d.level}`}>
      <div className="sent-card__head">
        <Icon name={d.level === 'normal' ? 'send' : 'flag'} size={18} />
        <strong>{heading}</strong>
        <span className="mono sent-card__ticket">{issue.ticket}</span>
      </div>
      <p className="small">{DISPATCH[d.level].note} {d.reasons.length > 0 && <>The AI rated it on {d.reasons.join(', ')}.</>}</p>
      <dl className="kv sent-card__kv">
        <div><dt>Type</dt><dd><CategoryTag id={issue.category} /></dd></div>
        <div><dt>Goes to</dt><dd>{departmentById(issue.department).name}</dd></div>
        <div><dt>Place</dt><dd>{ex.missing?.includes('location') ? <span className="warn-text">Not found yet</span> : issue.location}</dd></div>
        <div><dt>Noticed</dt><dd>{ex.whenText ? <>“{ex.whenText}” · {formatDateTime(issue.occurredAt)}</> : 'Not mentioned, so now'}</dd></div>
        <div><dt>Priority</dt><dd><PriorityBadge priority={issue.priority} /></dd></div>
        {(ex.peopleCount || ex.manyAffected) && <div><dt>People affected</dt><dd>{ex.peopleCount ? `about ${ex.peopleCount}` : 'many'}</dd></div>}
      </dl>
      {dup && (
        <p className="sent-card__dupe"><Icon name="link" size={14} />
          This looks like <span className="mono">{dup.ticket}</span> “{dup.title}” ({pct(dup.similarity)} match). An administrator will check whether it’s the same problem.
        </p>
      )}
      <div className="chat-actions">
        <Link className="btn btn--primary btn--sm" to={`/student/reports/${issue.id}`}>Track {issue.ticket}</Link>
        <Link className="btn btn--ghost btn--sm" to={`/student/reports/${issue.id}`}><Icon name="edit" size={14} />Correct details</Link>
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis, issue, live }) {
  if (issue) {
    return (
      <aside className="analysis card">
        <h2 className="eyebrow"><Icon name="cpu" size={14} />What the AI decided</h2>
        <div className="row gap-xs wrap"><FlagBadge dispatch={issue.dispatch} showNormal /><PriorityBadge priority={issue.priority} /></div>
        <dl className="kv kv--stack">
          <div><dt>Severity</dt><dd><Segments value={issue.ai.severity} tone={issue.ai.severity >= 4 ? 'hot' : undefined} /> <span className="mono small">{issue.ai.severity}/5</span></dd></div>
          <div><dt>Urgency</dt><dd><Segments value={issue.ai.urgency} tone={issue.ai.urgency >= 4 ? 'hot' : undefined} /> <span className="mono small">{issue.ai.urgency}/5</span></dd></div>
          <div><dt>Safety risk</dt><dd className="mono">{pct(issue.ai.safetyImpact)}</dd></div>
        </dl>
        <PriorityBreakdown priority={issue.priority} />
      </aside>
    );
  }
  if (!analysis) {
    return (
      <aside className="analysis card">
        <h2 className="eyebrow"><Icon name="cpu" size={14} />What CampusCare reads</h2>
        <p className="muted">Start describing the problem. The type, place, urgency and how it will be sent appear here as you type.</p>
        <div className="analysis__ghost" aria-hidden="true"><span /><span /><span /></div>
      </aside>
    );
  }
  const { ai, priority, extracted: ex = {}, dispatch } = analysis;
  return (
    <aside className="analysis card">
      <h2 className="eyebrow"><Icon name="cpu" size={14} />What CampusCare reads {live && <span className="pill-live">updating</span>}</h2>
      {dispatch && (
        <p className={`will-send will-send--${dispatch.level}`}>
          <Icon name={dispatch.level === 'normal' ? 'send' : 'flag'} size={14} />
          {dispatch.level === 'critical' ? 'Will be sent as a critical alert' : dispatch.level === 'high' ? 'Will be flagged high priority' : 'Will go to the admin queue'}
        </p>
      )}
      <dl className="kv kv--stack">
        <div><dt>Type</dt><dd><CategoryTag id={ai.category} /> <span className="muted small">{pct(ai.confidence)}</span></dd></div>
        <div><dt>Goes to</dt><dd>{departmentById(categoryById(ai.category).department).name}</dd></div>
        <div><dt>Place</dt><dd>{ex.location || <span className="warn-text">Not found yet</span>}</dd></div>
        <div><dt>Noticed</dt><dd>{ex.whenText ? `“${ex.whenText}”` : <span className="muted">Not mentioned</span>}</dd></div>
        <div><dt>Severity</dt><dd><Segments value={ai.severity} tone={ai.severity >= 4 ? 'hot' : undefined} /> <span className="mono small">{ai.severity}/5</span></dd></div>
        <div><dt>Urgency</dt><dd><Segments value={ai.urgency} tone={ai.urgency >= 4 ? 'hot' : undefined} /> <span className="mono small">{ai.urgency}/5</span></dd></div>
      </dl>
      {ai.signals?.length > 0 && (
        <div className="signals">
          <span className="muted small">Picked up from your words</span>
          <div className="row gap-xs wrap">{ai.signals.map((s) => <span key={s} className="signal">{s}</span>)}</div>
        </div>
      )}
      <PriorityBreakdown priority={priority} />
      {analysis.similar?.length > 0 && (
        <p className="analysis__similar"><Icon name="link" size={14} />{analysis.similar.length} similar open {analysis.similar.length === 1 ? 'report' : 'reports'} found. Administrators will see the link.</p>
      )}
    </aside>
  );
}
