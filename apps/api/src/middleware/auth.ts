import type { NextFunction, Request } from 'express';

import type { AppResponse, MemberResponse } from '../app-locals.js';
import { findSessionMember } from '../modules/auth/session.js';

// Looks up the session on every request, so changes to a member (such as the
// admin flag) and signed-out sessions take effect immediately.
export async function requireMember(
  req: Request,
  res: AppResponse,
  next: NextFunction,
) {
  const { db, clock } = res.locals;
  const member = await findSessionMember(db, req, clock());

  if (!member) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }

  (res as MemberResponse).locals.member = member;
  next();
}

export async function requireAdmin(
  req: Request,
  res: AppResponse,
  next: NextFunction,
) {
  await requireMember(req, res, () => {
    if (!(res as MemberResponse).locals.member.isAdmin) {
      res.status(403).json({ error: 'Only the venue admin can manage rooms.' });
      return;
    }

    next();
  });
}
