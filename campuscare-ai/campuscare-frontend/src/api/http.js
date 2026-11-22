import axios from 'axios';
import { API_URL } from '../config.js';

export const SESSION_KEY = 'campuscare.session';

export function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
export function writeSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked */ }
}

const http = axios.create({ baseURL: API_URL, timeout: 15000 });

// Attach the JWT issued by POST /auth/login.
http.interceptors.request.use((config) => {
  const token = readSession()?.token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Normalise errors to { status, message } so screens can show one readable line.
http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status || 0;
    const message =
      err.response?.data?.message ||
      (status === 0 ? 'Cannot reach the CampusCare server. Check that the backend is running.' : `Request failed (${status}).`);
    if (status === 401) {
      writeSession(null);
      window.dispatchEvent(new Event('campuscare:logout'));
    }
    return Promise.reject(Object.assign(new Error(message), { status }));
  }
);

export default http;
