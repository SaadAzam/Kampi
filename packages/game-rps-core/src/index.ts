import { z } from 'zod';
import type { GameManifest } from '@kampi/game-sdk/common';
import {
  resolveRpsRound,
  isMatchComplete,
  getPublicChoice,
  shouldConcealChoice,
  createRandomSource,
  type RpsChoice,
  type RoundOutcome,
  type PlayerSlot,
  type RandomSource,
} from '@kampi/contracts';

export const RPS_GAME_ID = 'rock-paper-scissors';

export const rpsManifest: GameManifest = {
  gameId: RPS_GAME_ID,
  displayName: 'Rock Paper Scissors',
  protocolVersion: '1.0.0',
  roomName: 'rps',
  clientLaunchPath: '/play/rps',
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ['PUBLIC', 'PRIVATE'],
  botCapable: true,
  configSchemaVersion: '1.0.0',
};

export const RpsGameConfigSchema = z.object({
  bestOf: z.number().int().positive().default(3),
  entryFee: z.string().default('500'),
  winnerPayout: z.string().default('950'),
  roundTimeoutMs: z.number().int().positive().default(15_000),
  botFillAfterMs: z.number().int().positive().default(10_000),
  reconnectGraceMs: z.number().int().positive().default(30_000),
});
export type RpsGameConfig = z.infer<typeof RpsGameConfigSchema>;

export const SubmitChoiceCommandSchema = z.object({
  type: z.literal('submit_choice'),
  protocolVersion: z.string(),
  gameId: z.literal(RPS_GAME_ID),
  commandId: z.string().uuid(),
  choice: z.enum(['ROCK', 'PAPER', 'SCISSORS']),
});

export {
  resolveRpsRound,
  isMatchComplete,
  getPublicChoice,
  shouldConcealChoice,
  createRandomSource,
};
export type { RpsChoice, RoundOutcome, PlayerSlot, RandomSource };
