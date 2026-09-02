import { randomUUID } from 'node:crypto';
import { prisma, type Prisma } from '@kampi/database';
import type { Seat } from '@kampi/game-sdk/common';

export async function createMatchRecord(options: {
  gameSlug: string;
  entryFee: bigint;
  winnerPayout: bigint;
  bestOf: number;
  botFill: boolean;
  playerA: { userId: string; displayName: string; kind: 'HUMAN' | 'BOT' };
  playerB: { userId: string; displayName: string; kind: 'HUMAN' | 'BOT' };
  metadata?: Prisma.InputJsonValue;
}): Promise<{ matchId: string; gameId: string }> {
  const game = await prisma.game.findUniqueOrThrow({
    where: { slug: options.gameSlug },
  });

  const matchId = randomUUID();

  await prisma.match.create({
    data: {
      id: matchId,
      gameId: game.id,
      status: 'WAITING',
      entryFee: options.entryFee,
      winnerPayout: options.winnerPayout,
      bestOf: options.bestOf,
      botFill: options.botFill,
      metadata: options.metadata ?? {},
      players: {
        create: [
          {
            slot: 1,
            userId: options.playerA.kind === 'HUMAN' ? options.playerA.userId : null,
            kind: options.playerA.kind,
            displayName: options.playerA.displayName,
            entryFeeKey:
              options.playerA.kind === 'HUMAN'
                ? `entry:${matchId}:${options.playerA.userId}`
                : `entry:${matchId}:bot:A`,
          },
          {
            slot: 2,
            userId: options.playerB.kind === 'HUMAN' ? options.playerB.userId : null,
            kind: options.playerB.kind,
            displayName: options.playerB.displayName,
            entryFeeKey:
              options.playerB.kind === 'HUMAN'
                ? `entry:${matchId}:${options.playerB.userId}`
                : `entry:${matchId}:bot:B`,
          },
        ],
      },
    },
  });

  await prisma.matchEvent.create({
    data: {
      matchId,
      type: 'MATCH_CREATED',
      payload: { botFill: options.botFill, gameSlug: options.gameSlug },
    },
  });

  if (options.botFill) {
    await prisma.matchEvent.create({
      data: {
        matchId,
        type: 'BOT_FILLED',
        payload: {},
      },
    });
  }

  return { matchId, gameId: game.id };
}

export function seatToSlot(seat: Seat): number {
  return seat === 'A' ? 1 : 2;
}

export function slotToSeat(slot: number): Seat {
  return slot === 1 ? 'A' : 'B';
}
