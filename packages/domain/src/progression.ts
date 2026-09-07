import { Prisma, PrismaClient, MatchPlayerResult, MatchStatus, AuditAction } from '@kampi/database';
import type { LeaderboardPeriod, PlayerStats } from '@kampi/contracts';

type DbClient = PrismaClient | Prisma.TransactionClient;

export const XP_PER_WIN = 50;
export const XP_PER_LOSS = 15;
export const XP_PER_DRAW = 25;
export const XP_PER_LEVEL = 100;

export function levelFromXp(xp: number): number {
  return 1 + Math.floor(Math.max(0, xp) / XP_PER_LEVEL);
}

export function xpForResult(result: MatchPlayerResult): number {
  if (result === MatchPlayerResult.WIN) return XP_PER_WIN;
  if (result === MatchPlayerResult.LOSS) return XP_PER_LOSS;
  if (result === MatchPlayerResult.DRAW) return XP_PER_DRAW;
  return 0;
}

/** ISO week key, e.g. weekly:2026-W36 */
export function weeklyPeriodKey(date: Date = new Date()): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `weekly:${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKeyFor(period: LeaderboardPeriod, date: Date = new Date()): string {
  return period === 'all-time' ? 'all-time' : weeklyPeriodKey(date);
}

export type RecordMatchOutcomeInput = {
  matchId: string;
  winnerSlot: number;
  winnerUserId?: string | null;
  scores?: Array<{ slot: number; score: number }>;
};

export async function recordMatchOutcome(
  prisma: PrismaClient,
  input: RecordMatchOutcomeInput,
): Promise<{ recorded: boolean }> {
  const match = await prisma.match.findUnique({
    where: { id: input.matchId },
    include: { players: true },
  });
  if (!match) return { recorded: false };
  if (match.status !== MatchStatus.FINISHED) return { recorded: false };
  if (match.players.length > 0 && match.players.every((player) => player.result !== null)) {
    return { recorded: false };
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${input.matchId}::uuid FOR UPDATE`;
    const fresh = await tx.match.findUnique({
      where: { id: input.matchId },
      include: { players: true },
    });
    if (!fresh || fresh.status !== MatchStatus.FINISHED) return;
    if (fresh.players.length > 0 && fresh.players.every((player) => player.result !== null)) {
      return;
    }

    for (const userId of [
      ...new Set(fresh.players.flatMap((p) => (p.userId ? [p.userId] : []))),
    ].sort()) {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
    }
    const weekKey = weeklyPeriodKey();
    for (const player of fresh.players) {
      const isWinner = player.slot === input.winnerSlot;
      const result = isWinner ? MatchPlayerResult.WIN : MatchPlayerResult.LOSS;
      const score = input.scores?.find((entry) => entry.slot === player.slot)?.score;

      await tx.matchPlayer.update({
        where: { id: player.id },
        data: {
          result,
          ...(score !== undefined ? { score } : {}),
        },
      });

      if (player.kind !== 'HUMAN' || !player.userId) continue;

      await applyProgression(tx, {
        userId: player.userId,
        gameId: fresh.gameId,
        result,
      });
      await applyLeaderboard(tx, {
        userId: player.userId,
        gameId: fresh.gameId,
        periodKey: weekKey,
        won: isWinner,
      });
      await applyLeaderboard(tx, {
        userId: player.userId,
        gameId: fresh.gameId,
        periodKey: 'all-time',
        won: isWinner,
      });
    }

    await tx.auditLog.create({
      data: {
        action: AuditAction.MATCH_FINALIZED,
        entityType: 'Match',
        entityId: input.matchId,
        metadata: {
          winnerSlot: input.winnerSlot,
          winnerUserId: input.winnerUserId ?? null,
        },
      },
    });
  });

  return { recorded: true };
}

async function applyProgression(
  tx: DbClient,
  input: { userId: string; gameId: string; result: MatchPlayerResult },
) {
  const xpDelta = xpForResult(input.result);
  const existing = await tx.playerProgression.findUnique({
    where: {
      userId_gameId: { userId: input.userId, gameId: input.gameId },
    },
  });

  const wins = (existing?.wins ?? 0) + (input.result === MatchPlayerResult.WIN ? 1 : 0);
  const losses = (existing?.losses ?? 0) + (input.result === MatchPlayerResult.LOSS ? 1 : 0);
  const draws = (existing?.draws ?? 0) + (input.result === MatchPlayerResult.DRAW ? 1 : 0);
  const xp = (existing?.xp ?? 0) + xpDelta;
  const level = levelFromXp(xp);

  await tx.playerProgression.upsert({
    where: {
      userId_gameId: { userId: input.userId, gameId: input.gameId },
    },
    create: {
      userId: input.userId,
      gameId: input.gameId,
      wins,
      losses,
      draws,
      xp,
      level,
    },
    update: { wins, losses, draws, xp, level },
  });
}

async function applyLeaderboard(
  tx: DbClient,
  input: { userId: string; gameId: string; periodKey: string; won: boolean },
) {
  const existing = await tx.leaderboardEntry.findUnique({
    where: {
      gameId_userId_periodKey: {
        gameId: input.gameId,
        userId: input.userId,
        periodKey: input.periodKey,
      },
    },
  });
  const score = (existing?.score ?? 0) + (input.won ? 1 : 0);

  await tx.leaderboardEntry.upsert({
    where: {
      gameId_userId_periodKey: {
        gameId: input.gameId,
        userId: input.userId,
        periodKey: input.periodKey,
      },
    },
    create: {
      gameId: input.gameId,
      userId: input.userId,
      periodKey: input.periodKey,
      score,
    },
    update: { score },
  });
}

export async function getPlayerStats(prisma: DbClient, userId: string): Promise<PlayerStats> {
  const rows = await prisma.playerProgression.findMany({
    where: { userId },
    include: { game: true },
    orderBy: { updatedAt: 'desc' },
  });

  const games = rows.map((row) => ({
    gameId: row.gameId,
    gameSlug: row.game.slug,
    gameName: row.game.name,
    xp: row.xp,
    level: row.level,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  }));

  const totals = games.reduce(
    (acc, game) => ({
      xp: acc.xp + game.xp,
      wins: acc.wins + game.wins,
      losses: acc.losses + game.losses,
      draws: acc.draws + game.draws,
    }),
    { xp: 0, wins: 0, losses: 0, draws: 0 },
  );

  return {
    ...totals,
    level: levelFromXp(totals.xp),
    games,
  };
}

export async function getLeaderboards(
  prisma: DbClient,
  input: { gameSlug?: string; period: LeaderboardPeriod; limit: number },
) {
  const periodKey = periodKeyFor(input.period);
  const games = await prisma.game.findMany({
    where: {
      status: 'ACTIVE',
      ...(input.gameSlug ? { slug: input.gameSlug } : {}),
    },
    orderBy: { name: 'asc' },
  });

  const boards = await Promise.all(
    games.map(async (game) => {
      const entries = await prisma.leaderboardEntry.findMany({
        where: { gameId: game.id, periodKey },
        include: { user: true },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
        take: input.limit,
      });

      return {
        gameSlug: game.slug,
        gameName: game.name,
        period: input.period,
        periodKey,
        entries: entries.map((entry, index) => ({
          rank: index + 1,
          userId: entry.userId,
          displayName: entry.user.displayName,
          score: entry.score,
        })),
      };
    }),
  );

  return { period: input.period, periodKey, boards };
}
