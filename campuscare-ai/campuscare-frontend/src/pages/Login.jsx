import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Brand } from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import { ErrorNote } from '../components/ui.jsx';
import { INSTITUTE, USE_MOCK } from '../config.js';

const DEMO = {
  student: { email: 'student@bvcoe.edu.in', password: 'demo1234' },
  admin: { email: 'admin@bvcoe.edu.in', password: 'demo1234' },
};

export default function Login() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState('student');
  const [form, setForm] = useState(USE_MOCK ? DEMO.student : { email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('signin'); // 'signin' | 'register' (students only)
  const [signup, setSignup] = useState({ name: '', email: '', enrollment: '', branch: '', password: '' });

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/student/report'} replace />;

  const pickRole = (r) => {
    setRole(r);
    setError(null);
    if (USE_MOCK) setForm(DEMO[r]);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = mode === 'register' ? await register(signup) : await login({ ...form, role });
      const from = location.state?.from;
      navigate(from && from.startsWith(`/${u.role}`) ? from : u.role === 'admin' ? '/admin' : '/student/report', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login__intro">
        <Brand />
        <h1 className="display">Report it once.<br />The right team sees it first.</h1>
        <p className="login__lede">
          Describe a problem on campus in your own words. CampusCare reads it, works out how urgent it is,
          checks whether others already reported it, and sends it to the department that can fix it.
        </p>
        <ul className="login__facts">
          <li><Icon name="cpu" size={18} /><span><strong>Classified on arrival</strong> into 9 issue types and routed to 8 departments</span></li>
          <li><Icon name="activity" size={18} /><span><strong>Priority score 0–100</strong> from severity, urgency, safety risk and how many students are affected</span></li>
          <li><Icon name="layers" size={18} /><span><strong>Duplicate reports linked</strong> so one fix closes them all</span></li>
        </ul>
        <p className="muted small">{INSTITUTE}</p>
      </section>

      <section className="login__panel">
        <form className="card login__form" onSubmit={submit} noValidate>
          {mode === 'register' ? (
            <>
              <h2>Create a student account</h2>
              <label className="field">
                <span>Full name</span>
                <input id="signup-name" autoComplete="name" value={signup.name} onChange={(e) => setSignup({ ...signup, name: e.target.value })} />
              </label>
              <label className="field">
                <span>College email</span>
                <input id="signup-email" type="email" autoComplete="email" value={signup.email}
                  onChange={(e) => setSignup({ ...signup, email: e.target.value })} placeholder="name@bvcoe.edu.in" />
              </label>
              <div className="form-grid form-grid--pair">
                <label className="field">
                  <span>Enrollment no. <span className="muted">(optional)</span></span>
                  <input id="signup-enrollment" inputMode="numeric" value={signup.enrollment} onChange={(e) => setSignup({ ...signup, enrollment: e.target.value })} />
                </label>
                <label className="field">
                  <span>Branch <span className="muted">(optional)</span></span>
                  <input id="signup-branch" value={signup.branch} onChange={(e) => setSignup({ ...signup, branch: e.target.value })} placeholder="ECE" />
                </label>
              </div>
              <label className="field">
                <span>Password</span>
                <input id="signup-password" type="password" autoComplete="new-password" value={signup.password}
                  onChange={(e) => setSignup({ ...signup, password: e.target.value })} placeholder="At least 8 characters" />
              </label>
              <ErrorNote error={error} />
              <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
              <p className="hint">Already registered? <button type="button" className="link-btn" onClick={() => { setMode('signin'); setError(null); }}>Sign in</button></p>
            </>
          ) : (
            <>
              <h2>Sign in</h2>
              <div className="segmented" role="tablist" aria-label="Sign in as">
                {['student', 'admin'].map((r) => (
                  <button key={r} type="button" role="tab" aria-selected={role === r} className={role === r ? 'is-on' : ''} onClick={() => pickRole(r)}>
                    {r === 'student' ? 'Student' : 'Administrator'}
                  </button>
                ))}
              </div>

              <label className="field">
                <span>College email</span>
                <input id="login-email" type="email" autoComplete="username" required value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@bvcoe.edu.in" />
              </label>
              <label className="field">
                <span>Password</span>
                <input id="login-password" type="password" autoComplete="current-password" required value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </label>

              <ErrorNote error={error} />

              <button className="btn btn--primary btn--block" disabled={busy}>
                {busy ? 'Signing in…' : `Sign in as ${role === 'admin' ? 'administrator' : 'student'}`}
              </button>

              {role === 'student' && (
                <p className="hint">New here? <button type="button" className="link-btn" onClick={() => { setMode('register'); setError(null); }}>Create a student account</button></p>
              )}
              {USE_MOCK && (
                <p className="hint">
                  Demo accounts are filled in for you. Open the student and administrator views in two tabs to watch reports arrive live.
                </p>
              )}
            </>
          )}
        </form>
      </section>
    </div>
  );
}
