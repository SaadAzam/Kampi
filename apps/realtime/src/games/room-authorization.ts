import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([key, item]) => key !== 'creationProof' && item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Only the server lobby can authorize a room's identities and economy. */
export function authorizeRoom<T extends object>(options: T): T & { creationProof: string } {
  const creationProof = createHmac('sha256', env.JWT_SECRET)
    .update(canonical(options))
    .digest('hex');
  return { ...options, creationProof };
}

export function assertRoomAuthorized<T extends object & { creationProof?: string }>(
  options: T,
): void {
  const proof = options.creationProof;
  if (
    typeof proof !== 'string' ||
    !/^[a-f0-9]{64}$/.test(proof) ||
    !timingSafeEqual(
      Buffer.from(proof, 'hex'),
      Buffer.from(authorizeRoom(options).creationProof, 'hex'),
    )
  ) {
    throw new Error('Match rooms must be created by the lobby');
  }
}
