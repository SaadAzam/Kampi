import { randomBytes } from 'node:crypto';
import type { Presence } from '@colyseus/core';

export type PrivateSessionRecord = {
  code: string;
  gameId: string;
  gameVersion: string;
  stakeKey: string;
  creatorUserId: string;
  creatorDisplayName: string;
  matchId?: string;
  expiresAt: number;
};

const PREFIX = 'kampi:private:';
const TTL_SECONDS = 10 * 60;

function key(code: string): string {
  return `${PREFIX}${code.toUpperCase()}`;
}

export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[(bytes[i] ?? 0) % alphabet.length];
  }
  return out;
}

export async function savePrivateSession(
  presence: Presence,
  record: PrivateSessionRecord,
): Promise<void> {
  await presence.setex(key(record.code), JSON.stringify(record), TTL_SECONDS);
}

export async function loadPrivateSession(
  presence: Presence,
  code: string,
): Promise<PrivateSessionRecord | null> {
  const raw = await presence.get(key(code));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PrivateSessionRecord;
    if (parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deletePrivateSession(presence: Presence, code: string): Promise<void> {
  await presence.del(key(code));
}
