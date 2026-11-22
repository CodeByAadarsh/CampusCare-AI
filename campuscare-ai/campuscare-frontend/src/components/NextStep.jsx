import { useEffect, useRef, useState } from 'react';
import api from '../api/index.js';
import Icon from './Icon.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { DEPARTMENTS, departmentById } from '../lib/constants.js';

/**
 * The admin workflow, reduced to two clicks:
 *   To assign (New / Pending)       -> "Assign to <team the AI picked>"   (also acknowledges any alert)
 *   With a team (Assigned / In progress) -> "Mark resolved"
 */
export function nextStep(issue) {
  if (['new', 'pending'].includes(issue.status)) return { kind: 'assign', label: `Assign to ${departmentById(issue.department).short}` };
  if (['assigned', 'in_progress'].includes(issue.status)) return { kind: 'resolve', label: 'Mark resolved' };
  return null;
}

/** One button for the next step. For assigning, a small arrow opens the list of other teams. */
export default function NextStepButton({ issue, onDone, primary = false }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // null, or the menu position (fixed, so tables and cards can't clip it)
  const ref = useRef(null);
  const step = nextStep(issue);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(null); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(null); };
    const hide = () => setOpen(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide);
    };
  }, [open]);

  if (!step) return null;

  const run = async (department) => {
    setOpen(null);
    setBusy(true);
    try {
      const updated = step.kind === 'assign'
        ? await api.assignIssue(issue.id, { department: department || issue.department })
        : await api.updateStatus(issue.id, { status: 'resolved' });
      notify({
        tone: 'success',
        title: step.kind === 'assign' ? `${issue.ticket} assigned to ${departmentById(updated.department).short}` : `${issue.ticket} resolved`,
        body: step.kind === 'assign' ? 'Moved to "With a team". The student sees it straight away.' : 'The student has been told it is fixed.',
      });
      onDone?.(updated);
    } catch (e) {
      notify({ tone: 'critical', title: 'Could not update', body: e.message });
    } finally { setBusy(false); }
  };

  const cls = `btn btn--sm ${primary || step.kind === 'assign' ? 'btn--primary' : 'btn--ghost'}`;
  return (
    <div className="next-step" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className={`${cls} next-step__main`} disabled={busy} onClick={() => run()}>
        {step.kind === 'resolve' && <Icon name="check" size={14} />}
        {busy ? 'Saving…' : step.label}
      </button>
      {step.kind === 'assign' && (
        <button className={`${cls} next-step__more`} disabled={busy} onClick={(e) => {
            if (open) { setOpen(null); return; }
            const r = e.currentTarget.getBoundingClientRect();
            const below = window.innerHeight - r.bottom > 330;
            setOpen({ right: Math.max(8, window.innerWidth - r.right), ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
          }}
          aria-label="Assign to a different team" aria-expanded={!!open} title="Assign to a different team">
          <Icon name="chevronDown" size={14} />
        </button>
      )}
      {open && (
        <ul className="next-step__menu card" role="menu" aria-label="Assign to" style={open}>
          <li className="next-step__menu-head small muted">Assign to another team</li>
          {Object.values(DEPARTMENTS).filter((d) => d.id !== issue.department).map((d) => (
            <li key={d.id}><button role="menuitem" onClick={() => run(d.id)}>{d.name}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
