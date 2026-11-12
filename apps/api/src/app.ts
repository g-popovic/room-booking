import type { DatabaseClient } from '@room-booking/db';
import express from 'express';

import type { AppResponse } from './app-locals.js';
import { errorHandler } from './middleware/error-handler.js';
import { createDemoSessions } from './modules/auth/demo-session.js';
import authRoutes from './modules/auth/routes.js';
import bookingRoutes from './modules/bookings/routes.js';
import {
  calendarFeedRoutes,
  calendarRoutes,
} from './modules/calendar/routes.js';
import roomRoutes from './modules/rooms/routes.js';

export function createApp(db: DatabaseClient, clock = () => new Date()) {
  const app = express();
  const sessions = createDemoSessions();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.use((_req, res: AppResponse, next) => {
    res.locals.db = db;
    res.locals.sessions = sessions;
    res.locals.clock = clock;

    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/session', authRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/calendar-feed', calendarFeedRoutes);
  app.use('/api/calendar', calendarRoutes);

  app.use(errorHandler);

  return app;
}
