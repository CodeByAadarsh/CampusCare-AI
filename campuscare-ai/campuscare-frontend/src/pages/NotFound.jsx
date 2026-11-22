import { Link } from 'react-router-dom';
import { Brand } from '../components/Layout.jsx';

export default function NotFound() {
  return (
    <div className="center-page">
      <Brand />
      <h1 className="display">This page does not exist</h1>
      <p className="muted">The link may be old, or the report was removed.</p>
      <Link className="btn btn--primary" to="/">Go to your home screen</Link>
    </div>
  );
}
