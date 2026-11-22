import { levelLabel } from '../lib/constants.js';

/**
 * Explains a priority score: each factor's weighted contribution as a stacked bar,
 * so an admin can see *why* something is ranked first.
 */
export default function PriorityBreakdown({ priority }) {
  return (
    <div className="breakdown">
      <div className="breakdown__head">
        <span className={`breakdown__score prio-ink--${priority.level}`}>{priority.score}</span>
        <span className="breakdown__of">/ 100</span>
        <span className={`prio prio--${priority.level}`}><span className="prio__dot" />{levelLabel(priority.level)}</span>
      </div>
      <div className="breakdown__stack" aria-hidden="true">
        {priority.breakdown.map((p) => (
          <span key={p.key} className={`seg seg--${p.key}`} style={{ width: `${p.points}%` }} />
        ))}
      </div>
      <dl className="breakdown__list">
        {priority.breakdown.map((p) => (
          <div key={p.key}>
            <dt><span className={`swatch seg--${p.key}`} />{p.label}<span className="muted small"> × {p.weight}</span></dt>
            <dd><span className="muted">{p.raw}</span><strong className="mono">+{p.points}</strong></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
