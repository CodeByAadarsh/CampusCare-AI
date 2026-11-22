import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { FlagBadge, PriorityBadge, StatusBadge, CategoryTag } from './ui.jsx';
import { departmentById } from '../lib/constants.js';
import { timeAgo } from '../lib/format.js';

/** One report in a list. The left stripe encodes priority level so urgent rows stand out. */
export default function IssueRow({ issue, to, showDepartment = true, actions, fresh }) {
  return (
    <article className={`issue-row stripe--${issue.status === 'resolved' || issue.status === 'duplicate' ? 'closed' : issue.priority.level} ${fresh ? 'is-fresh' : ''}`}>
      <Link to={to} className="issue-row__main">
        <div className="issue-row__top">
          <span className="mono muted">{issue.ticket}</span>
          <StatusBadge status={issue.status} />
          <CategoryTag id={issue.category} />
          {issue.status !== 'resolved' && issue.status !== 'duplicate' && <FlagBadge dispatch={issue.dispatch} />}
        </div>
        <h3 className="issue-row__title">{issue.title}</h3>
        <div className="issue-row__meta">
          <span><Icon name="pin" size={14} />{issue.location}</span>
          <span><Icon name="clock" size={14} />{timeAgo(issue.createdAt)}</span>
          <span><Icon name="users" size={14} />{issue.affectedCount} affected</span>
          {showDepartment && <span className="hide-sm">→ {departmentById(issue.department).short}{issue.assignee ? ` · ${issue.assignee}` : ''}</span>}
        </div>
      </Link>
      <div className="issue-row__side">
        <PriorityBadge priority={issue.priority} />
        {actions}
      </div>
    </article>
  );
}
