import { z } from 'zod';

export const MatchStatusSchema = z.enum([
  'WAITING',
  'ACTIVE',
  'RESOLVING',
  'FINISHED',
  'ABORTED',
]);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

export const RpsChoiceSchema = z.enum(['ROCK', 'PAPER', 'SCISSORS']);
export type RpsChoice = z.infer<typeof RpsChoiceSchema>;

export const RoundOutcomeSchema = z.enum(['PLAYER1', 'PLAYER2', 'DRAW']);
export type RoundOutcome = z.infer<typeof RoundOutcomeSchema>;

export const PlayerSlotSchema = z.enum(['PLAYER1', 'PLAYER2']);
export type PlayerSlot = z.infer<typeof PlayerSlotSchema>;

export const MatchPlayerKindSchema = z.enum(['HUMAN', 'BOT']);
export type MatchPlayerKind = z.infer<typeof MatchPlayerKindSchema>;

export const GAME_SLUGS = {
  RPS: 'rock-paper-scissors',
  PENALTY: 'penalty-duel',
} as const;

export const EconomyConfigSchema = z.object({
  startingChips: z.coerce.bigint().default(10000n),
  rpsEntryFee: z.coerce.bigint().default(500n),
  rpsWinnerPayout: z.coerce.bigint().default(950n),
  botFillAfterMs: z.coerce.number().int().positive().default(10_000),
  reconnectGraceMs: z.coerce.number().int().positive().default(30_000),
});
export type EconomyConfig = z.infer<typeof EconomyConfigSchema>;

export const GameConfigSchema = z.object({
  slug: z.string(),
  name: z.string(),
  entryFee: z.string(),
  winnerPayout: z.string(),
  bestOf: z.number().int().positive(),
  botFillAfterMs: z.number().int().positive(),
  reconnectGraceMs: z.number().int().positive(),
});
export type GameConfig = z.infer<typeof GameConfigSchema>;

/** Serialize BigInt for JSON APIs */
export function chipsToString(value: bigint): string {
  return value.toString();
}

export function parseChips(value: string | bigint): bigint {
  if (typeof value === 'bigint') return value;
  return BigInt(value);
}
