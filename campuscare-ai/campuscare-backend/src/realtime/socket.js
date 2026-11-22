/**
 * Socket.IO layer.
 * The client connects with `io(SOCKET_URL, { auth: { token } })`.
 * Rooms: every admin joins "admins"; every user joins "user:<id>".
 * Events (server -> client), payload = the full issue as returned by the REST API:
 *   issue:created   new report (admins + reporter)
 *   issue:updated   any change (admins + every affected student)
 *   issue:flagged   AI flagged a report critical/high, or re-alerted it (admins only)
 */
import { Server } from 'socket.io';
import { config } from '../config.js';
import { verifyToken } from '../middleware/auth.js';

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.clientOrigins },
  });

  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth?.token || '');
      socket.data.user = { id: payload.sub, role: payload.role, name: payload.name };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.data.user;
    socket.join(`user:${id}`);
    if (role === 'admin') socket.join('admins');
  });

  return io;
}

/** Rooms that should hear about a change to this issue. */
function roomsFor(issue) {
  const ids = new Set([issue.reporter?.id, ...(issue.affectedUsers || [])].filter(Boolean).map(String));
  return ['admins', ...[...ids].map((uid) => `user:${uid}`)];
}

export function emitIssue(event, issue) {
  if (!io) return;
  io.to(roomsFor(issue)).emit(event, issue);
}

/** Admin-only events, e.g. issue:flagged (a report the AI flagged for immediate attention). */
export function emitAdmins(event, payload) {
  if (!io) return;
  io.to('admins').emit(event, payload);
}
