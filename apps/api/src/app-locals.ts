import type { DatabaseClient } from '@room-booking/db';
import type { Response } from 'express';

import type { DemoSessions } from './modules/auth/demo-session.js';

export interface AppLocals {
  db: DatabaseClient;
  sessions: DemoSessions;
  clock: () => Date;
}

export type AppResponse = Response<unknown, AppLocals>;
