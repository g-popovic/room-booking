import { ADMIN_ID } from '@room-booking/db';
import type { RequestHandler } from 'express';
import type { DemoSessions } from '../modules/auth/demo-session.js';

export function requireAdmin(sessions: DemoSessions): RequestHandler {
  return (req, res, next) => {
    if (sessions.read(req) !== ADMIN_ID) {
      res.status(403).json({ error: 'Only the venue admin can manage rooms.' });
      return;
    }
    next();
  };
}
