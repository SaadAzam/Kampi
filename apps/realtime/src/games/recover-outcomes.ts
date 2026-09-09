import { z } from 'zod';
import { prisma } from '@kampi/database';
import { recordMatchOutcome } from '@kampi/domain';

const Outcome = z.object({
  winnerSeat: z.enum(['A', 'B']),
  scores: z.object({ A: z.number().int().nonnegative(), B: z.number().int().nonnegative() }),
});

/** Repair committed payouts whose stats transaction was interrupted, including process restarts. */
export async function recoverPenaltyOutcomes(): Promise<void> {
  const matches = await prisma.match.findMany({
    where: {
      status: 'FINISHED',
      game: { slug: 'penalty-duel' },
      players: { some: { result: null } },
    },
    include: {
      events: { where: { type: 'MATCH_FINISHED' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  for (const match of matches) {
    const parsed = Outcome.safeParse(match.events[0]?.payload);
    if (!parsed.success) continue;
    const outcome = parsed.data;
    await recordMatchOutcome(prisma, {
      matchId: match.id,
      winnerSlot: outcome.winnerSeat === 'A' ? 1 : 2,
      winnerUserId: match.winnerPlayerId,
      scores: [
        { slot: 1, score: outcome.scores.A },
        { slot: 2, score: outcome.scores.B },
      ],
    });
  }
}
