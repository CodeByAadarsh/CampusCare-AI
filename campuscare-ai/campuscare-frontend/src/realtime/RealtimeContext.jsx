/**
 * Real-time layer. Against the real backend this opens one Socket.IO connection
 * (JWT passed in `auth.token`; the server puts admins in an "admins" room and each
 * student in "user:<id>"). In mock mode it listens to the mock event bus, which also
 * relays events between browser tabs.
 */
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { USE_MOCK, SOCKET_URL } from '../config.js';
import { onMockEvent } from '../api/mockServer.js';
import { useAuth } from '../context/AuthContext.jsx';

const RealtimeContext = createContext({ connected: false, subscribe: () => () => {} });
const EVENTS = ['issue:created', 'issue:updated', 'issue:flagged', 'issue:reset'];

export function RealtimeProvider({ children }) {
  const { user, token } = useAuth();
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Map()); // event -> Set<fn>

  const dispatch = useCallback((event, payload) => {
    handlers.current.get(event)?.forEach((fn) => fn(payload));
  }, []);

  useEffect(() => {
    if (!user) { setConnected(false); return undefined; }

    if (USE_MOCK) {
      const offs = EVENTS.map((ev) => onMockEvent(ev, (p) => dispatch(ev, p)));
      setConnected(true);
      return () => { offs.forEach((off) => off()); setConnected(false); };
    }

    let socket;
    let cancelled = false;
    import('socket.io-client').then(({ io }) => {
      if (cancelled) return;
      socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'] });
      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => setConnected(false));
      EVENTS.forEach((ev) => socket.on(ev, (p) => dispatch(ev, p)));
    });
    return () => { cancelled = true; socket?.disconnect(); setConnected(false); };
  }, [user, token, dispatch]);

  const subscribe = useCallback((event, fn) => {
    if (!handlers.current.has(event)) handlers.current.set(event, new Set());
    handlers.current.get(event).add(fn);
    return () => handlers.current.get(event)?.delete(fn);
  }, []);

  return <RealtimeContext.Provider value={{ connected, subscribe }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Run `handler` whenever one of `events` arrives. The latest handler is always used. */
export function useRealtimeEvent(events, handler) {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  const key = [].concat(events).join(',');
  useEffect(() => {
    const offs = key.split(',').map((ev) => subscribe(ev, (p) => ref.current(p, ev)));
    return () => offs.forEach((off) => off());
  }, [key, subscribe]);
}
