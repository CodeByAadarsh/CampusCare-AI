// Central runtime configuration, read from Vite env variables (see .env.example).
const env = import.meta.env || {};

/** When true the app runs against the in-browser mock backend (src/api/mockServer.js). */
export const USE_MOCK = String(env.VITE_USE_MOCK ?? 'true') !== 'false';

/** Base URL of the Express REST API, e.g. http://localhost:8000/api */
export const API_URL = env.VITE_API_URL || 'http://localhost:8000/api';

/** Socket.IO server URL. */
export const SOCKET_URL = env.VITE_SOCKET_URL || 'http://localhost:8000';

/** 'browser' for normal paths, 'hash' for #/paths (static hosting). */
export const ROUTER_MODE = env.VITE_ROUTER_MODE || 'browser';

export const APP_NAME = 'CampusCare AI';
export const INSTITUTE = 'Bharati Vidyapeeth’s College of Engineering, New Delhi';

/**
 * Uploaded photos come back from the API as paths like /api/uploads/ab12.jpg.
 * Resolve them against the API's origin so they load when the frontend runs on another port.
 */
export function assetUrl(src) {
  if (!src || /^(data:|blob:|https?:)/.test(src)) return src;
  return /^https?:/.test(API_URL) ? new URL(src, API_URL).href : src;
}
