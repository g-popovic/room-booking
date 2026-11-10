import { Router } from 'express';
import { z } from 'zod';

import type { AppResponse } from '../../app-locals.js';

const router = Router();

const memberInput = z.object({ id: z.string().min(1) });

function toAccount(member: { id: string; name: string; is_admin: boolean }) {
  return { id: member.id, name: member.name, isAdmin: member.is_admin };
}

router.get('/', async (req, res: AppResponse) => {
  const { db, sessions } = res.locals;
  const memberId = sessions.read(req);

  const members = await db
    .selectFrom('members')
    .select(['id', 'name', 'is_admin'])
    .orderBy('name')
    .execute();

  const accounts = members.map(toAccount);

  res.json({
    account: accounts.find((account) => account.id === memberId) ?? null,
    accounts,
  });
});

router.post('/', async (req, res: AppResponse) => {
  const { db, sessions } = res.locals;
  const { id } = memberInput.parse(req.body);

  const member = await db
    .selectFrom('members')
    .select(['id', 'name', 'is_admin'])
    .where('id', '=', id)
    .executeTakeFirst();

  if (!member) {
    return res.status(404).json({ error: 'Demo account not found.' });
  }

  sessions.set(res, id);
  res.json(toAccount(member));
});

router.delete('/', (_req, res: AppResponse) => {
  res.locals.sessions.clear(res);
  res.sendStatus(204);
});

export default router;
