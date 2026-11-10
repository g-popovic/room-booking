import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

const COOKIE = 'room_booking_demo';
const MAX_AGE = 12 * 60 * 60_000;

export function createDemoSessions() {
  const key = randomBytes(32);

  const sign = (value: string) =>
    createHmac('sha256', key).update(value).digest('base64url');

  return {
    read(req: Request) {
      const cookie = req.headers.cookie
        ?.split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith(COOKIE + '='))
        ?.slice(COOKIE.length + 1);

      if (!cookie) return null;

      const [id, expires, signature] = cookie.split('.');

      if (!id || !expires || !signature || !(Number(expires) > Date.now()))
        return null;

      const actual = Buffer.from(signature);
      const expected = Buffer.from(sign(`${id}.${expires}`));

      return actual.length === expected.length &&
        timingSafeEqual(actual, expected)
        ? id
        : null;
    },
    set(res: Response, id: string) {
      const value = `${id}.${Date.now() + MAX_AGE}`;

      res.cookie(COOKIE, `${value}.${sign(value)}`, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: MAX_AGE,
      });
    },
    clear(res: Response) {
      res.clearCookie(COOKIE);
    },
  };
}

export type DemoSessions = ReturnType<typeof createDemoSessions>;
