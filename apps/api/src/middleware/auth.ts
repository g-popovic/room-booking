import type { NextFunction, Request } from 'express';

import type { AppResponse } from '../app-locals.js';

export async function requireAdmin(
  req: Request,
  res: AppResponse,
  next: NextFunction,
) {
  const { db, sessions } = res.locals;
  const memberId = sessions.read(req);

  const admin = memberId
    ? await db
        .selectFrom('members')
        .select('id')
        .where('id', '=', memberId)
        .where('is_admin', '=', true)
        .executeTakeFirst()
    : undefined;

  if (!admin) {
    res.status(403).json({ error: 'Only the venue admin can manage rooms.' });
    return;
  }

  next();
}
