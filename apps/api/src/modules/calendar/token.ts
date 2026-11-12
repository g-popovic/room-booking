import { createHash, randomBytes } from 'node:crypto';

// 32 random bytes encode to exactly 43 base64url characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createFeedToken() {
  const token = randomBytes(32).toString('base64url');

  return { token, hash: hashFeedToken(token) };
}

// Tokens are long and random, so a fast unsalted hash is enough to keep the
// stored value useless on its own while still allowing an indexed lookup.
export function hashFeedToken(token: string) {
  return createHash('sha256').update(token).digest();
}

export function isFeedToken(value: string) {
  return TOKEN_PATTERN.test(value);
}

export function feedPath(token: string) {
  return `/api/calendar/${token}.ics`;
}
