// Database-backed sessions. The browser holds a random token in an HTTP-only
// cookie; Postgres stores only its SHA-256 hash, next to the member and an
// expiry. Deleting the row signs the browser out, even if the cookie is kept.
import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseClient } from '@room-booking/db';
import type { Request, Response } from 'express';

import type { Member } from '../../app-locals.js';

const COOKIE = 'roomwell_session';
const MAX_AGE = 14 * 24 * 60 * 60_000;
// 32 random bytes encode to exactly 43 base64url characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Tokens are long and random, so a fast unsalted hash is enough to make the
// stored value useless on its own while still allowing an indexed lookup.
function hashToken(token: string) {
  return createHash('sha256').update(token).digest();
}

export function readSessionToken(req: Request) {
  const token = req.headers.cookie
    ?.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1);

  return token && TOKEN_PATTERN.test(token) ? token : null;
}

export async function startSession(
  db: DatabaseClient,
  res: Response,
  memberId: string,
  now: Date,
) {
  const token = randomBytes(32).toString('base64url');

  // Clear out this member's expired sessions while we're here. Expired
  // sessions of members who never sign in again stay until something else
  // removes them.
  await db
    .deleteFrom('sessions')
    .where('member_id', '=', memberId)
    .where('expires_at', '<=', now)
    .execute();

  await db
    .insertInto('sessions')
    .values({
      token_hash: hashToken(token),
      member_id: memberId,
      created_at: now,
      expires_at: new Date(now.getTime() + MAX_AGE),
    })
    .execute();

  // The app only runs on http://127.0.0.1 for now. Add `secure: true` once it
  // is served over HTTPS.
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function findSessionMember(
  db: DatabaseClient,
  req: Request,
  now: Date,
): Promise<Member | null> {
  const token = readSessionToken(req);
  if (!token) return null;

  const member = await db
    .selectFrom('sessions')
    .innerJoin('members', 'members.id', 'sessions.member_id')
    .select([
      'members.id',
      'members.name',
      'members.email',
      'members.is_admin as isAdmin',
    ])
    .where('sessions.token_hash', '=', hashToken(token))
    .where('sessions.expires_at', '>', now)
    .executeTakeFirst();

  return member ?? null;
}

// Deletes the browser's current session, if it has one, without touching
// the cookie.
export async function revokeSession(db: DatabaseClient, req: Request) {
  const token = readSessionToken(req);

  if (token)
    await db
      .deleteFrom('sessions')
      .where('token_hash', '=', hashToken(token))
      .execute();
}

export async function endSession(
  db: DatabaseClient,
  req: Request,
  res: Response,
) {
  await revokeSession(db, req);
  res.clearCookie(COOKIE, { path: '/' });
}
