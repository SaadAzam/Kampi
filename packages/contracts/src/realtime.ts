import { z } from 'zod';
import { RpsChoiceSchema } from './common.js';

export const ClientToServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join_queue'),
    gameSlug: z.string(),
    authToken: z.string().min(1),
  }),
  z.object({
    type: z.literal('leave_queue'),
  }),
  z.object({
    type: z.literal('submit_choice'),
    choice: RpsChoiceSchema,
  }),
  z.object({
    type: z.literal('ping'),
  }),
]);

export type ClientToServerMessage = z.infer<typeof ClientToServerMessageSchema>;

export const ServerToClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('queue_joined'),
    ticketId: z.string().uuid(),
    position: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('queue_left'),
  }),
  z.object({
    type: z.literal('match_found'),
    matchId: z.string().uuid(),
    roomId: z.string(),
    reconnectionToken: z.string().optional(),
    opponentKind: z.enum(['HUMAN', 'BOT']),
    botFill: z.boolean(),
  }),
  z.object({
    type: z.literal('match_state'),
    snapshot: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('pong'),
  }),
]);

export type ServerToClientMessage = z.infer<typeof ServerToClientMessageSchema>;

export const RpsPublicPlayerSchema = z.object({
  slot: z.enum(['PLAYER1', 'PLAYER2']),
  displayName: z.string(),
  kind: z.enum(['HUMAN', 'BOT']),
  score: z.number().int().nonnegative(),
  connected: z.boolean(),
  choiceLocked: z.boolean(),
});

export const RpsPublicRoundSchema = z.object({
  roundNumber: z.number().int().positive(),
  outcome: z.enum(['PLAYER1', 'PLAYER2', 'DRAW']).nullable(),
  revealedChoices: z
    .object({
      player1: RpsChoiceSchema.nullable(),
      player2: RpsChoiceSchema.nullable(),
    })
    .nullable(),
});

export const RpsMatchSnapshotSchema = z.object({
  matchId: z.string().uuid(),
  status: z.enum(['WAITING', 'ACTIVE', 'RESOLVING', 'FINISHED', 'ABORTED']),
  bestOf: z.number().int().positive(),
  currentRound: z.number().int().nonnegative(),
  roundDeadlineMs: z.number().int().nullable(),
  players: z.array(RpsPublicPlayerSchema),
  rounds: z.array(RpsPublicRoundSchema),
  winnerSlot: z.enum(['PLAYER1', 'PLAYER2']).nullable(),
  abortReason: z.string().nullable(),
  botFill: z.boolean(),
});

export type RpsMatchSnapshot = z.infer<typeof RpsMatchSnapshotSchema>;

export function parseClientMessage(raw: unknown): ClientToServerMessage {
  return ClientToServerMessageSchema.parse(raw);
}

export function parseServerMessage(raw: unknown): ServerToClientMessage {
  return ServerToClientMessageSchema.parse(raw);
}
