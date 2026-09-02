import { describe, expect, it } from 'vitest';
import {
  deletePrivateSession,
  generateInviteCode,
  loadPrivateSession,
  savePrivateSession,
  type PrivateSessionRecord,
} from './private-invite.js';

class MemoryPresence {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async setex(key: string, value: string, seconds: number) {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
  }

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string) {
    this.store.delete(key);
  }
}

describe('private invite sessions', () => {
  it('generates unguessable-enough codes', () => {
    const a = generateInviteCode();
    const b = generateInviteCode();
    expect(a).toHaveLength(8);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z2-9]+$/);
  });

  it('round-trips through presence TTL store', async () => {
    const presence = new MemoryPresence() as never;
    const record: PrivateSessionRecord = {
      code: 'ABCD2345',
      gameId: 'penalty-duel',
      gameVersion: '1.0.0',
      stakeKey: 'default',
      creatorUserId: 'user-a',
      creatorDisplayName: 'A',
      expiresAt: Date.now() + 60_000,
    };
    await savePrivateSession(presence, record);
    const loaded = await loadPrivateSession(presence, 'abcd2345');
    expect(loaded?.creatorUserId).toBe('user-a');
    await deletePrivateSession(presence, 'ABCD2345');
    expect(await loadPrivateSession(presence, 'ABCD2345')).toBeNull();
  });

  it('rejects expired records', async () => {
    const presence = new MemoryPresence() as never;
    await savePrivateSession(presence, {
      code: 'EXPIRED1',
      gameId: 'penalty-duel',
      gameVersion: '1.0.0',
      stakeKey: 'default',
      creatorUserId: 'user-a',
      creatorDisplayName: 'A',
      expiresAt: Date.now() - 1,
    });
    expect(await loadPrivateSession(presence, 'EXPIRED1')).toBeNull();
  });
});
