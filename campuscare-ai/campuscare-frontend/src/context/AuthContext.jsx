import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/index.js';
import { readSession, writeSession } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());

  useEffect(() => {
    const onLogout = () => setSession(null);
    window.addEventListener('campuscare:logout', onLogout);
    return () => window.removeEventListener('campuscare:logout', onLogout);
  }, []);

  const login = useCallback(async (credentials) => {
    const res = await api.login(credentials);
    writeSession(res);
    setSession(res);
    return res.user;
  }, []);

  const register = useCallback(async (details) => {
    const res = await api.register(details);
    writeSession(res);
    setSession(res);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    writeSession(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user: session?.user || null, token: session?.token || null, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
