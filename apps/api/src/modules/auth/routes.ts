import { ADMIN_ID } from '@room-booking/db';
import type { DatabaseClient } from '@room-booking/db';
import { Router } from 'express';
import { z } from 'zod';
import type { DemoSessions } from './demo-session.js';

const memberInput = z.object({ id: z.string().min(1) });

export function createAuthRoutes(db: DatabaseClient, sessions: DemoSessions) {
  const router = Router();

  router.get('/', async (req, res) => {
    const members = await db
      .selectFrom('members')
      .selectAll()
      .orderBy('name')
      .execute();
    const accounts = members.map((member) => ({
      ...member,
      isAdmin: member.id === ADMIN_ID,
    }));
    res.json({
      account:
        accounts.find((account) => account.id === sessions.read(req)) ?? null,
      accounts,
    });
  });

  router.post('/', async (req, res) => {
    const { id } = memberInput.parse(req.body);
    const member = await db
      .selectFrom('members')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!member)
      return res.status(404).json({ error: 'Demo account not found.' });
    sessions.set(res, id);
    res.json({ ...member, isAdmin: member.id === ADMIN_ID });
  });

  router.delete('/', (_req, res) => {
    sessions.clear(res);
    res.sendStatus(204);
  });

  return router;
}
