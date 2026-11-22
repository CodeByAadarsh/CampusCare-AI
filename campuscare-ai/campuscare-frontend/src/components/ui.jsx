import Icon from './Icon.jsx';
import { DISPATCH, categoryById, departmentById, statusById, levelLabel } from '../lib/constants.js';
import { useRealtime } from '../realtime/RealtimeContext.jsx';

export function StatusBadge({ status }) {
  return <span className={`status status--${status}`}>{statusById(status).label}</span>;
}

/** Priority shown as a pill: level label + score out of 100. */
export function PriorityBadge({ priority, compact = false }) {
  if (!priority) return null;
  return (
    <span className={`prio prio--${priority.level}`} title={`Priority score ${priority.score}/100`}>
      <span className="prio__dot" />
      {!compact && levelLabel(priority.level)}
      <span className="prio__score">{priority.score}</span>
    </span>
  );
}

/** Automatic-dispatch flag: shown on critical and high reports; pulses until an admin acknowledges it. */
export function FlagBadge({ dispatch, showNormal = false }) {
  if (!dispatch || (dispatch.level === 'normal' && !showNormal)) return null;
  const waiting = dispatch.level !== 'normal' && !dispatch.acknowledgedAt;
  return (
    <span className={`flag flag--${dispatch.level} ${waiting ? 'flag--waiting' : ''}`}
      title={`${DISPATCH[dispatch.level].short}: ${dispatch.reasons.join(', ')}${waiting ? ' · not acknowledged yet' : ''}`}>
      <Icon name="flag" size={12} />
      {DISPATCH[dispatch.level].short}
    </span>
  );
}

export function CategoryTag({ id }) {
  const c = categoryById(id);
  return (
    <span className="tag">
      <Icon name={c.icon} size={14} />
      {c.label}
    </span>
  );
}

export function DepartmentTag({ id }) {
  return <span className="tag tag--dept">{departmentById(id).name}</span>;
}

export function LiveDot() {
  const { connected } = useRealtime();
  return (
    <span className={`live ${connected ? 'live--on' : ''}`} title={connected ? 'Receiving live updates' : 'Reconnecting…'}>
      <span className="live__dot" />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error-note" role="alert">
      <Icon name="alert" size={18} />
      <span>{error.message || String(error)}</span>
      {onRetry && <button className="btn btn--ghost btn--sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Horizontal bars, all drawn on one shared scale (max of the set). */
export function BarList({ items, valueKey = 'open', highlightKey, onSelect }) {
  const max = Math.max(1, ...items.map((i) => i[valueKey]));
  return (
    <ul className="barlist">
      {items.map((i) => (
        <li key={i.id}>
          <button type="button" className="barlist__row" onClick={onSelect ? () => onSelect(i) : undefined} disabled={!onSelect}>
            <span className="barlist__label">{i.label}</span>
            <span className="barlist__track">
              <span className="barlist__fill" style={{ width: `${(i[valueKey] / max) * 100}%` }} />
              {highlightKey && i[highlightKey] > 0 && (
                <span className="barlist__fill barlist__fill--hot" style={{ width: `${(i[highlightKey] / max) * 100}%` }} />
              )}
            </span>
            <span className="barlist__value">{i[valueKey]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 1–5 scale rendered as five segments. */
export function Segments({ value, max = 5, tone }) {
  return (
    <span className={`segments ${tone ? `segments--${tone}` : ''}`} aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={i < value ? 'on' : ''} />)}
    </span>
  );
}
