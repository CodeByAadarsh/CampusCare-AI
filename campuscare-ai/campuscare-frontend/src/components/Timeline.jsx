import { statusById } from '../lib/constants.js';
import { formatDateTime } from '../lib/format.js';

export default function Timeline({ entries }) {
  return (
    <ol className="timeline">
      {[...entries].reverse().map((e, i) => (
        <li key={`${e.at}-${i}`} className={`timeline__item status-ink--${e.status}`}>
          <span className="timeline__dot" />
          <div>
            <div className="timeline__head">
              <strong>{statusById(e.status).label}</strong>
              <time dateTime={e.at}>{formatDateTime(e.at)}</time>
            </div>
            {e.note && <p>{e.note}</p>}
            <span className="muted small">{e.by}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
