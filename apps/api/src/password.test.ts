import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '@room-booking/db/password';

test('passwords are salted and only verify with the same password', async () => {
  const [first, second] = await Promise.all([
    hashPassword('correct horse'),
    hashPassword('correct horse'),
  ]);

  assert.match(first, /^scrypt\$15\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('correct horse', first), true);
  assert.equal(await verifyPassword('correct horse', second), true);
  assert.equal(await verifyPassword('Correct horse', first), false);
  assert.equal(await verifyPassword('', first), false);
});

test('passwords are compared after Unicode normalisation', async () => {
  // "é" as one code point, and as "e" followed by a combining accent.
  const stored = await hashPassword('caf\u00e9-password');
  assert.equal(await verifyPassword('cafe\u0301-password', stored), true);
});

test('malformed stored hashes never verify', async () => {
  const valid = await hashPassword('password');
  const [, , , , salt, key] = valid.split('$');

  for (const stored of [
    '',
    'password',
    `bcrypt$15$8$1$${salt}$${key}`,
    `scrypt$abc$8$1$${salt}$${key}`,
    `scrypt$15$8$1$${salt}$`,
    `scrypt$15$8$1$${salt}$${key.slice(1)}`,
  ]) {
    assert.equal(await verifyPassword('password', stored), false, stored);
  }
});
