// Password hashing with Node's built-in scrypt. It lives in the db package
// because both the API and the demo seed need it.
//
// Stored format: scrypt$<log2 N>$<r>$<p>$<salt>$<hash>, base64url-encoded.
// The parameters are stored with each hash, so they can be raised later
// without breaking existing passwords.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

const LOG_N = 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      // scrypt needs 128 * N * r bytes, which for these parameters is exactly
      // Node's default 32 MiB limit, so allow twice that.
      { ...options, maxmem: 256 * options.N! * options.r! },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, { N: 2 ** LOG_N, r: R, p: P });

  return [
    'scrypt',
    LOG_N,
    R,
    P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, logN, r, p, salt, key] = stored.split('$');

  if (scheme !== 'scrypt' || !salt || !key) return false;
  if (![logN, r, p].every((value) => /^[1-9][0-9]?$/.test(value!)))
    return false;

  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), {
    N: 2 ** Number(logN),
    r: Number(r),
    p: Number(p),
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
