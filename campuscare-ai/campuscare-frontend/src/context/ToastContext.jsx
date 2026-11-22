import { createContext, useCallback, useContext, useState } from 'react';
import Icon from '../components/Icon.jsx';

const ToastContext = createContext({ notify: () => {} });

/** tone: 'info' | 'success' | 'critical' */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback(({ title, body, tone = 'info', action, timeout = 6000 }) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, title, body, tone, action }]);
    if (timeout) setTimeout(() => dismiss(id), timeout);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <Icon name={t.tone === 'critical' ? 'alert' : t.tone === 'success' ? 'check' : 'activity'} size={18} />
            <div className="toast__text">
              <strong>{t.title}</strong>
              {t.body && <span>{t.body}</span>}
              {t.action && (
                <button className="link-btn" onClick={() => { t.action.onClick(); dismiss(t.id); }}>{t.action.label}</button>
              )}
            </div>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
