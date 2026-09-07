import { describe, expect, it } from 'vitest';
import { displayNameFromEmail, hashPassword, verifyPassword } from './auth.js';

describe('password hashing', () => {
  it('verifies a matching password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct-horse-battery');
    await expect(verifyPassword('correct-horse-battery', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
  });
});

describe('displayNameFromEmail', () => {
  it('uses the local part of the email', () => {
    expect(displayNameFromEmail('saad.azam@kampi.fun')).toBe('saad azam');
  });
});
