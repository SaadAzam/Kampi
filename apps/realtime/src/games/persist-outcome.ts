import { prisma } from '@kampi/database';
import { recordMatchOutcome } from '@kampi/domain';

export async function persistMatchOutcome(
  input: {
    matchId: string;
    winnerSlot: number;
    winnerUserId?: string | null;
    scores?: Array<{ slot: number; score: number }>;
  },
  retryOnFailure = false,
): Promise<void> {
  try {
    await recordMatchOutcome(prisma, input);
  } catch (error) {
    console.error('Failed to record match stats', error);
    if (retryOnFailure) throw error;
  }
}
