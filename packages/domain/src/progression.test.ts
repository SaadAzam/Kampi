import { describe, expect, it, vi } from 'vitest';
import { MatchPlayerResult, MatchStatus } from '@kampi/database';
import {
  XP_PER_WIN,
  getLeaderboards,
  getPlayerStats,
  levelFromXp,
  periodKeyFor,
  recordMatchOutcome,
  weeklyPeriodKey,
} from './progression.js';

function createProgressionPrisma() {
  const players = [
    {
      id: 'mp-1',
      slot: 1,
      kind: 'HUMAN',
      userId: 'u-1',
      result: null as string | null,
      score: 0,
    },
    {
      id: 'mp-2',
      slot: 2,
      kind: 'BOT',
      userId: null as string | null,
      result: null as string | null,
      score: 0,
    },
  ];
  const progression = new Map<
    string,
    {
      userId: string;
      gameId: string;
      wins: number;
      losses: number;
      draws: number;
      xp: number;
      level: number;
    }
  >();
  const leaderboard = new Map<
    string,
    { gameId: string; userId: string; periodKey: string; score: number }
  >();

  const tx = {
    $queryRaw: vi.fn(async () => []),
    match: {
      findUnique: vi.fn(async () => ({
        id: 'm-1',
        gameId: 'g-1',
        status: MatchStatus.FINISHED,
        players,
      })),
    },
    matchPlayer: {
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { result: string; score?: number };
        }) => {
          const player = players.find((row) => row.id === where.id);
          if (player) Object.assign(player, data);
          return player;
        },
      ),
    },
    playerProgression: {
      findUnique: vi.fn(
        async ({ where }: { where: { userId_gameId: { userId: string; gameId: string } } }) => {
          return (
            progression.get(`${where.userId_gameId.userId}:${where.userId_gameId.gameId}`) ?? null
          );
        },
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId_gameId: { userId: string; gameId: string } };
          create: {
            userId: string;
            gameId: string;
            wins: number;
            losses: number;
            draws: number;
            xp: number;
            level: number;
          };
          update: { wins: number; losses: number; draws: number; xp: number; level: number };
        }) => {
          const key = `${where.userId_gameId.userId}:${where.userId_gameId.gameId}`;
          const next = progression.has(key) ? { ...progression.get(key)!, ...update } : create;
          progression.set(key, next);
          return next;
        },
      ),
    },
    leaderboardEntry: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { gameId_userId_periodKey: { gameId: string; userId: string; periodKey: string } };
        }) => {
          const key = `${where.gameId_userId_periodKey.gameId}:${where.gameId_userId_periodKey.userId}:${where.gameId_userId_periodKey.periodKey}`;
          return leaderboard.get(key) ?? null;
        },
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { gameId_userId_periodKey: { gameId: string; userId: string; periodKey: string } };
          create: { gameId: string; userId: string; periodKey: string; score: number };
          update: { score: number };
        }) => {
          const key = `${where.gameId_userId_periodKey.gameId}:${where.gameId_userId_periodKey.userId}:${where.gameId_userId_periodKey.periodKey}`;
          const next = leaderboard.has(key) ? { ...leaderboard.get(key)!, ...update } : create;
          leaderboard.set(key, next);
          return next;
        },
      ),
    },
    auditLog: {
      create: vi.fn(async () => ({})),
    },
  };

  const prisma = {
    match: {
      findUnique: vi.fn(async () => ({
        id: 'm-1',
        gameId: 'g-1',
        status: MatchStatus.FINISHED,
        players,
      })),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    playerProgression: {
      findMany: vi.fn(async () => [
        {
          gameId: 'g-1',
          xp: XP_PER_WIN,
          level: 1,
          wins: 1,
          losses: 0,
          draws: 0,
          game: { slug: 'rock-paper-scissors', name: 'Rock Paper Scissors' },
        },
      ]),
    },
    game: {
      findMany: vi.fn(async () => [
        { id: 'g-1', slug: 'rock-paper-scissors', name: 'Rock Paper Scissors' },
      ]),
    },
    leaderboardEntry: {
      findMany: vi.fn(async () => [
        {
          userId: 'u-1',
          score: 3,
          user: { displayName: 'Dev Player' },
        },
      ]),
    },
  };

  return { prisma, tx, players, progression, leaderboard };
}

describe('levelFromXp', () => {
  it('starts at level 1 and increases every 100 XP', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(250)).toBe(3);
  });
});

describe('period keys', () => {
  it('formats ISO weekly keys', () => {
    expect(weeklyPeriodKey(new Date('2026-09-05T12:00:00Z'))).toBe('weekly:2026-W36');
    expect(periodKeyFor('all-time')).toBe('all-time');
  });
});

describe('recordMatchOutcome', () => {
  it('is idempotent after player results are stored', async () => {
    const { prisma, players, progression, leaderboard } = createProgressionPrisma();

    const first = await recordMatchOutcome(prisma as never, {
      matchId: 'm-1',
      winnerSlot: 1,
      winnerUserId: 'u-1',
      scores: [
        { slot: 1, score: 2 },
        { slot: 2, score: 0 },
      ],
    });
    expect(first.recorded).toBe(true);
    expect(players[0]?.result).toBe(MatchPlayerResult.WIN);
    expect(progression.get('u-1:g-1')?.wins).toBe(1);
    expect(leaderboard.size).toBe(2);

    const second = await recordMatchOutcome(prisma as never, {
      matchId: 'm-1',
      winnerSlot: 1,
      winnerUserId: 'u-1',
    });
    expect(second.recorded).toBe(false);
    expect(progression.get('u-1:g-1')?.wins).toBe(1);
  });
});

describe('stats reads', () => {
  it('aggregates progression and ranks leaderboard entries', async () => {
    const { prisma } = createProgressionPrisma();
    const stats = await getPlayerStats(prisma as never, 'u-1');
    expect(stats.wins).toBe(1);
    expect(stats.games[0]?.gameSlug).toBe('rock-paper-scissors');

    const boards = await getLeaderboards(prisma as never, {
      period: 'weekly',
      limit: 20,
    });
    expect(boards.boards[0]?.entries[0]).toMatchObject({
      rank: 1,
      displayName: 'Dev Player',
      score: 3,
    });
  });
});
