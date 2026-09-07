import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, WalletLedgerType } from '@kampi/database';
import {
  deductEntryFees,
  finalizeMatchPayout,
  mutateWallet,
  refundAbortedMatch,
} from './wallet.js';

const enabled = process.env.KAMPI_DB_INTEGRATION === '1';
const users: string[] = [],
  matches: string[] = [];
let gameId = '';
async function player(balance: bigint) {
  const id = randomUUID();
  users.push(id);
  await prisma.user.create({
    data: { id, displayName: 'Security regression test', wallet: { create: { balance } } },
  });
  return id;
}
async function match(a: string, b: string) {
  const id = randomUUID();
  matches.push(id);
  await prisma.match.create({
    data: {
      id,
      gameId,
      status: 'WAITING',
      entryFee: 500n,
      winnerPayout: 950n,
      bestOf: 6,
      players: {
        create: [a, b].map((userId, index) => ({
          userId,
          slot: index + 1,
          kind: 'HUMAN',
          displayName: 'Test',
          entryFeeKey: `entry:${id}:${userId}`,
        })),
      },
    },
  });
  return {
    matchId: id,
    entryFee: 500n,
    players: [a, b].map((userId, index) => ({
      userId,
      slot: index + 1,
      entryFeeKey: `entry:${id}:${userId}`,
    })),
  };
}

describe.skipIf(!enabled)('Postgres financial concurrency regressions', () => {
  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? '').hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
      throw new Error('Integration tests require a local database');
    gameId = (await prisma.game.findUniqueOrThrow({ where: { slug: 'penalty-duel' } })).id;
  });
  afterAll(async () => {
    await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId: { in: users } } } });
    await prisma.matchPlayer.deleteMany({ where: { matchId: { in: matches } } });
    await prisma.match.deleteMany({ where: { id: { in: matches } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  it('allows only one of two concurrent debits that would overdraw', async () => {
    const id = await player(1000n);
    const results = await Promise.allSettled(
      [1, 2].map((n) =>
        mutateWallet(prisma, {
          userId: id,
          amount: -700n,
          type: WalletLedgerType.MATCH_ENTRY,
          idempotencyKey: `test:${id}:${n}`,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance).toBe(300n);
    expect(await prisma.walletLedgerEntry.count({ where: { wallet: { userId: id } } })).toBe(1);
  });
  it('concurrent retries debit once', async () => {
    const id = await player(1000n);
    const input = {
      userId: id,
      amount: -500n,
      type: WalletLedgerType.MATCH_ENTRY,
      idempotencyKey: `test:${id}`,
    };
    const result = await Promise.all([mutateWallet(prisma, input), mutateWallet(prisma, input)]);
    expect(result.filter((r) => !r.duplicate)).toHaveLength(1);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance).toBe(500n);
  });
  it('rolls back both entry fees when one player cannot pay; abort mints nothing', async () => {
    const a = await player(1000n),
      b = await player(100n);
    const input = await match(a, b);
    await expect(deductEntryFees(prisma, input)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    await refundAbortedMatch(prisma, { ...input, abortRefundKey: `abort:${input.matchId}` });
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: a } })).balance).toBe(1000n);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: b } })).balance).toBe(100n);
    expect(await prisma.walletLedgerEntry.count({ where: { matchId: input.matchId } })).toBe(0);
  });
  it('serializes competing payout and refund; never pays both', async () => {
    const a = await player(1000n),
      b = await player(1000n);
    const input = await match(a, b);
    await deductEntryFees(prisma, input);
    await prisma.match.update({ where: { id: input.matchId }, data: { status: 'ACTIVE' } });
    await Promise.allSettled([
      finalizeMatchPayout(prisma, {
        matchId: input.matchId,
        winnerUserId: a,
        payout: 950n,
        payoutLedgerKey: `payout:${input.matchId}`,
      }),
      refundAbortedMatch(prisma, { ...input, abortRefundKey: `abort:${input.matchId}` }),
    ]);
    const entries = await prisma.walletLedgerEntry.findMany({ where: { matchId: input.matchId } });
    const payouts = entries.filter((e) => e.type === 'MATCH_PAYOUT');
    const refunds = entries.filter((e) => e.type === 'MATCH_REFUND');
    expect(
      (payouts.length === 1 && refunds.length === 0) ||
        (payouts.length === 0 && refunds.length === 2),
    ).toBe(true);
  });
});
