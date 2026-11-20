import type { DatabaseClient } from '@room-booking/db';
import type { Response } from 'express';

export interface Member {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface AppLocals {
  db: DatabaseClient;
  clock: () => Date;
}

export type AppResponse = Response<unknown, AppLocals>;

// For handlers behind requireMember, which sets the signed-in member.
export type MemberResponse = Response<unknown, AppLocals & { member: Member }>;
