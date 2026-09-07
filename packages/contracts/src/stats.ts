import { z } from 'zod';

export const LeaderboardPeriodSchema = z.enum(['weekly', 'all-time']);
export type LeaderboardPeriod = z.infer<typeof LeaderboardPeriodSchema>;

export const LeaderboardQuerySchema = z.object({
  gameSlug: z.string().min(1).optional(),
  period: LeaderboardPeriodSchema.default('weekly'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export const GameProgressionSchema = z.object({
  gameId: z.string().uuid(),
  gameSlug: z.string(),
  gameName: z.string(),
  xp: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
});
export type GameProgression = z.infer<typeof GameProgressionSchema>;

export const PlayerStatsSchema = z.object({
  xp: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  games: z.array(GameProgressionSchema),
});
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;

export const LeaderboardEntryViewSchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string().uuid(),
  displayName: z.string(),
  score: z.number().int().nonnegative(),
});
export type LeaderboardEntryView = z.infer<typeof LeaderboardEntryViewSchema>;

export const LeaderboardBoardSchema = z.object({
  gameSlug: z.string(),
  gameName: z.string(),
  period: LeaderboardPeriodSchema,
  periodKey: z.string(),
  entries: z.array(LeaderboardEntryViewSchema),
});
export type LeaderboardBoard = z.infer<typeof LeaderboardBoardSchema>;
