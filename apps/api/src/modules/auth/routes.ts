import { hashPassword, verifyPassword } from '@room-booking/db/password';
import { Router } from 'express';
import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import type { AppResponse, Member } from '../../app-locals.js';
import { emailAddress } from './email.js';
import {
  endSession,
  findSessionMember,
  revokeSession,
  startSession,
} from './session.js';

const registration = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter your name.' })
    .max(80, { error: 'Use a name of 80 characters or fewer.' }),
  email: emailAddress,
  password: z
    .string()
    .min(8, { error: 'Use a password of at least 8 characters.' })
    .max(128, { error: 'Use a password of 128 characters or fewer.' }),
});

// No length rules on sign-in, so a change to the rules above never locks out
// an existing account.
const credentials = z.object({
  email: emailAddress,
  password: z.string().min(1).max(1024),
});

// Checked against when the email is unknown, so a wrong email takes as long as
// a wrong password and response times don't reveal which emails have accounts.
const unknownMemberHash = hashPassword('roomwell-unknown-member');

// Limits are per client address and kept in memory, which is enough for a
// single local API process.
//
// Express leaves `trust proxy` off, so the address is the connection's. Next's
// dev server proxies /api from 127.0.0.1 and passes any X-Forwarded-For from
// the client through unchanged, so trusting that header would let anyone pick
// a new address for every attempt. Before serving the API elsewhere, put it
// behind a proxy that overwrites X-Forwarded-For, set `trust proxy` to exactly
// that proxy, and give both limiters a shared store if there are several API
// processes.
//
// Each limiter counts only the responses that help an attacker, so normal use
// never runs into them.
const limitFailedSignIns = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  // Counted per address and email: guessing one member's password is
  // limited without locking that member out from everywhere else.
  keyGenerator: (req: Request) => {
    const address = emailAddress.safeParse(req.body?.email);
    return `${ipKeyGenerator(req.ip ?? '')}|${address.data ?? ''}`;
  },
  // Only wrong credentials count.
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  message: {
    error:
      'Too many failed attempts to sign in. Wait up to 15 minutes and try again.',
  },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const limitRegistrationConflicts = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  // Only "already exists" counts, because that's the answer that reveals an
  // account. Successful sign-ups don't count, so a whole coworking space
  // sharing one address can still register.
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 409,
  message: {
    error:
      'Too many attempts to create an account. Wait up to an hour and try again.',
  },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const account = (member: Member) => ({
  id: member.id,
  name: member.name,
  email: member.email,
  isAdmin: member.isAdmin,
});

const router = Router();

router.get('/me', async (req, res: AppResponse) => {
  const { db, clock } = res.locals;
  const member = await findSessionMember(db, req, clock());

  res.json({ account: member && account(member) });
});

router.post(
  '/register',
  limitRegistrationConflicts,
  async (req, res: AppResponse) => {
    const { db, clock } = res.locals;
    const input = registration.safeParse(req.body);

    if (!input.success)
      return res.status(400).json({ error: input.error.issues[0].message });

    const { name, email, password } = input.data;
    const now = clock();

    try {
      const member = await db
        .insertInto('members')
        .values({
          name,
          email,
          password_hash: await hashPassword(password),
          created_at: now,
        })
        .returning(['id', 'name', 'email', 'is_admin as isAdmin'])
        .executeTakeFirstOrThrow();

      await revokeSession(db, req);
      await startSession(db, res, member.id, now);
      res.status(201).json(account(member));
    } catch (error) {
      if ((error as { constraint?: string }).constraint === 'members_email_key')
        return res.status(409).json({
          error: 'An account with that email already exists. Sign in instead.',
        });

      throw error;
    }
  },
);

router.post('/login', limitFailedSignIns, async (req, res: AppResponse) => {
  const { db, clock } = res.locals;
  const input = credentials.safeParse(req.body);

  if (!input.success)
    return res
      .status(400)
      .json({ error: 'Enter your email address and password.' });

  const { email, password } = input.data;

  const member = await db
    .selectFrom('members')
    .select(['id', 'name', 'email', 'is_admin as isAdmin', 'password_hash'])
    .where('email', '=', email)
    .executeTakeFirst();

  const matches = await verifyPassword(
    password,
    member?.password_hash ?? (await unknownMemberHash),
  );

  if (!member?.password_hash || !matches)
    return res
      .status(401)
      .json({ error: 'That email and password don’t match an account.' });

  // Signing in replaces any session this browser already had.
  await revokeSession(db, req);
  await startSession(db, res, member.id, clock());
  res.json(account(member));
});

router.post('/logout', async (req, res: AppResponse) => {
  await endSession(res.locals.db, req, res);
  res.sendStatus(204);
});

export default router;
