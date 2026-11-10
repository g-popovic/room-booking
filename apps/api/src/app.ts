import type { DatabaseClient } from '@room-booking/db';
import express from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { createDemoSessions } from './modules/auth/demo-session.js';
import { createAuthRoutes } from './modules/auth/routes.js';
import { createBookingRoutes } from './modules/bookings/routes.js';
import { createRoomRoutes } from './modules/rooms/routes.js';

export function createApp(db: DatabaseClient, clock = () => new Date()) {
  const app = express();
  const sessions = createDemoSessions();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/session', createAuthRoutes(db, sessions));
  app.use('/api/rooms', createRoomRoutes(db, sessions, clock));
  app.use('/api/bookings', createBookingRoutes(db, sessions, clock));
  app.use(errorHandler);

  return app;
}
