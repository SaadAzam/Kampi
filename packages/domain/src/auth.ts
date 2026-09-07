import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export const GUEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REGISTERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const value = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(value)) return new Uint8Array();
    bytes[i] = value;
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `${toHex(salt)}:${toHex(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const separator = storedHash.indexOf(':');
  if (separator <= 0) return false;
  const saltHex = storedHash.slice(0, separator);
  const hashHex = storedHash.slice(separator + 1);
  if (!saltHex || !hashHex) return false;

  const salt = fromHex(saltHex);
  const expected = fromHex(hashHex);
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = scryptSync(password, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0]?.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() ?? '';
  const candidate = local.length >= 2 ? local.slice(0, 32) : `Player ${Math.floor(Math.random() * 9000 + 1000)}`;
  return candidate;
}
