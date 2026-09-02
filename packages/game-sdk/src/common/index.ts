import { z } from 'zod';

export const GAME_SDK_PROTOCOL_VERSION = '1.0.0';

export const SeatSchema = z.enum(['A', 'B']);
export type Seat = z.infer<typeof SeatSchema>;

export const MatchModeSchema = z.enum(['PUBLIC', 'PRIVATE']);
export type MatchMode = z.infer<typeof MatchModeSchema>;

export const StakeTierSchema = z.object({
  entryFee: z.string(),
  winnerPayout: z.string(),
});
export type StakeTier = z.infer<typeof StakeTierSchema>;

export const GameManifestSchema = z.object({
  gameId: z.string().min(1),
  displayName: z.string().min(1),
  protocolVersion: z.string().min(1),
  clientLaunchPath: z.string().optional(),
  roomName: z.string().min(1),
  minPlayers: z.number().int().positive().default(2),
  maxPlayers: z.number().int().positive().default(2),
  supportedModes: z.array(MatchModeSchema).default(['PUBLIC', 'PRIVATE']),
  botCapable: z.boolean().default(true),
  configSchemaVersion: z.string().default('1.0.0'),
});
export type GameManifest = z.infer<typeof GameManifestSchema>;

export const EnvelopeBaseSchema = z.object({
  protocolVersion: z.string(),
  gameId: z.string(),
  matchId: z.string().uuid().optional(),
  commandId: z.string().uuid().optional(),
  type: z.string(),
});

export const QueueKeySchema = z.object({
  gameId: z.string(),
  gameVersion: z.string().default('1.0.0'),
  mode: MatchModeSchema.default('PUBLIC'),
  stakeKey: z.string().default('default'),
  region: z.string().default('global'),
});
export type QueueKey = z.infer<typeof QueueKeySchema>;

export function queueKeyString(key: QueueKey): string {
  return `${key.gameId}|${key.gameVersion}|${key.mode}|${key.stakeKey}|${key.region}`;
}

export type Clock = {
  now(): number;
};

export const systemClock: Clock = {
  now: () => Date.now(),
};

export type RandomProvider = {
  nextFloat(): number;
  nextInt(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
};

export function createRandomProvider(random: () => number = Math.random): RandomProvider {
  return {
    nextFloat: () => random(),
    nextInt(maxExclusive: number) {
      if (maxExclusive <= 0) throw new Error('maxExclusive must be positive');
      return Math.floor(random() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('Cannot pick from empty list');
      const item = items[Math.floor(random() * items.length)];
      if (item === undefined) throw new Error('Invalid pick index');
      return item;
    },
  };
}

export function remainingMs(deadlineAt: number, clock: Clock = systemClock): number {
  return Math.max(0, deadlineAt - clock.now());
}

export function isPastDeadline(deadlineAt: number, clock: Clock = systemClock): boolean {
  return clock.now() >= deadlineAt;
}

export const SdkErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'ALREADY_QUEUED',
  'QUEUE_MISMATCH',
  'INVALID_MESSAGE',
  'INVALID_COMMAND',
  'WRONG_PHASE',
  'WRONG_ROLE',
  'WRONG_TURN',
  'DUPLICATE_COMMAND',
  'RATE_LIMITED',
  'MATCH_FULL',
  'SESSION_EXPIRED',
  'SESSION_NOT_FOUND',
  'UNSUPPORTED_PROTOCOL',
  'UNSUPPORTED_GAME',
  'SAME_PLAYER',
  'INTERNAL',
]);
export type SdkErrorCode = z.infer<typeof SdkErrorCodeSchema>;

export class SdkError extends Error {
  constructor(
    public readonly code: SdkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SdkError';
  }
}
