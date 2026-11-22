import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { FlagBadge } from './ui.jsx';
import { useAlerts } from '../context/AlertsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { timeAgo } from '../lib/format.js';

/** One alert line: what, where, why the AI flagged it, and the two actions an admin needs. */
export function AlertItem({ issue, onDone, compact = false }) {
  const { acknowledge } = useAlerts();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const ack = async () => {
    setBusy(true);
    try {
      await acknowledge(issue.id);
      notify({ tone: 'success', title: `${issue.ticket} acknowledged`, body: 'The student can see it is being handled.' });
      onDone?.();
    } catch (e) {
      notify({ tone: 'critical', title: 'Could not acknowledge', body: e.message });
      setBusy(false);
    }
  };
  return (
    <li className={`alert-item alert-item--${issue.dispatch.level}`}>
      <div className="alert-item__main">
        <div className="row gap-xs wrap">
          <FlagBadge dispatch={issue.dispatch} />
          <span className="mono small muted">{issue.ticket}</span>
          <span className="small muted">{timeAgo(issue.dispatch.sentAt || issue.createdAt)}</span>
          {issue.dispatch.escalations > 0 && <span className="small strong alert-item__late">reminded {issue.dispatch.escalations}×</span>}
        </div>
        <Link to={`/admin/issues/${issue.id}`} className="alert-item__title" onClick={onDone}>{issue.title}</Link>
        <span className="small muted"><Icon name="pin" size={12} /> {issue.location}{!compact && ` · ${issue.dispatch.reasons.join(', ')}`}</span>
      </div>
      <button className="btn btn--primary btn--sm" disabled={busy} onClick={ack}>{busy ? 'Saving…' : 'Acknowledge'}</button>
    </li>
  );
}

/** Bell in the side rail with the number of flagged reports waiting; opens the alert list. */
export function AlertBell() {
  const { items, counts, muted, toggleMuted, permission, requestPermission } = useAlerts();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const total = counts.critical + counts.high;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="bell" ref={ref}>
      <button className={`icon-btn bell__btn ${counts.critical ? 'bell__btn--critical' : ''}`} onClick={() => setOpen((o) => !o)}
        aria-label={`${total} flagged ${total === 1 ? 'report' : 'reports'} waiting`} aria-expanded={open}>
        <Icon name="bell" size={18} />
        {total > 0 && <span className={`bell__count ${counts.critical ? 'bell__count--critical' : ''}`}>{total}</span>}
      </button>
      {open && (
        <div className="alerts-panel card" role="dialog" aria-label="Flagged reports">
          <header className="alerts-panel__head">
            <strong>Flagged by AI · waiting</strong>
            <button className="icon-btn" onClick={toggleMuted} title={muted ? 'Turn alarm sound on' : 'Mute alarm sound'} aria-pressed={!muted}>
              <Icon name="volume" size={16} /><span className="small">{muted ? 'Sound off' : 'Sound on'}</span>
            </button>
          </header>
          {items.length ? (
            <ul className="alert-list">{items.map((i) => <AlertItem key={i.id} issue={i} onDone={() => setOpen(false)} compact />)}</ul>
          ) : <p className="muted small alerts-panel__empty">Nothing waiting. Critical and high reports appear here the moment they arrive.</p>}
          {permission === 'default' && (
            <button className="link-btn small" onClick={requestPermission}><Icon name="bell" size={14} />Also show desktop notifications</button>
          )}
          <Link to="/admin/issues?status=flagged" className="link-btn small" onClick={() => setOpen(false)}>All flagged reports <Icon name="chevron" size={14} /></Link>
        </div>
      )}
    </div>
  );
}

/** Red banner across the top of every admin page while a critical report is unacknowledged. */
export function CriticalBanner() {
  const { banner, hide } = useAlerts();
  if (!banner.length) return null;
  const [first, ...rest] = banner;
  return (
    <div className="critical-banner" role="alert">
      <Icon name="alert" size={20} />
      <div className="critical-banner__text">
        <strong>Critical report{first.dispatch.escalations ? ', still not acknowledged' : ''}: {first.title}</strong>
        <span>{first.location} · {first.ticket} · {first.dispatch.reasons.join(', ')}{rest.length ? ` · ${rest.length} more critical` : ''}</span>
      </div>
      <ul className="critical-banner__actions"><AlertItemActions issue={first} /></ul>
      <button className="icon-btn critical-banner__hide" onClick={() => hide(first.id)} aria-label="Hide this alert in this tab" title="Hide in this tab"><Icon name="x" size={16} /></button>
    </div>
  );
}

function AlertItemActions({ issue }) {
  const { acknowledge } = useAlerts();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <li><Link className="btn btn--sm critical-banner__open" to={`/admin/issues/${issue.id}`}>Open</Link></li>
      <li>
        <button className="btn btn--sm critical-banner__ack" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await acknowledge(issue.id); notify({ tone: 'success', title: `${issue.ticket} acknowledged` }); }
          catch (e) { notify({ tone: 'critical', title: 'Could not acknowledge', body: e.message }); }
          finally { setBusy(false); }
        }}>{busy ? 'Saving…' : 'Acknowledge'}</button>
      </li>
    </>
  );
}
