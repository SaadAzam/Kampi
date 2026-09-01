import { z } from 'zod';

export const EMBED_PROTOCOL_VERSION = '1.0.0';

export const EmbedHostToGameMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('host_ready'),
    protocolVersion: z.string(),
    allowedOrigins: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('session'),
    authToken: z.string().min(1),
    playerId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('locale'),
    locale: z.string(),
  }),
  z.object({
    type: z.literal('theme'),
    theme: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('request_close'),
    reason: z.string().optional(),
  }),
]);

export const EmbedGameToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('game_ready'),
    protocolVersion: z.string(),
    gameSlug: z.string(),
  }),
  z.object({
    type: z.literal('balance_changed'),
    balance: z.string(),
  }),
  z.object({
    type: z.literal('match_started'),
    matchId: z.string().uuid(),
    gameSlug: z.string(),
  }),
  z.object({
    type: z.literal('match_completed'),
    matchId: z.string().uuid(),
    result: z.enum(['WIN', 'LOSS', 'DRAW', 'ABORTED']),
    payout: z.string().nullable(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('request_close'),
    reason: z.string().optional(),
  }),
]);

export type EmbedHostToGameMessage = z.infer<typeof EmbedHostToGameMessageSchema>;
export type EmbedGameToHostMessage = z.infer<typeof EmbedGameToHostMessageSchema>;

export function parseHostMessage(raw: unknown): EmbedHostToGameMessage {
  return EmbedHostToGameMessageSchema.parse(raw);
}

export function parseGameMessage(raw: unknown): EmbedGameToHostMessage {
  return EmbedGameToHostMessageSchema.parse(raw);
}

export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.some((allowedOrigin) => {
    if (allowedOrigin === '*') return true;
    return origin === allowedOrigin;
  });
}
