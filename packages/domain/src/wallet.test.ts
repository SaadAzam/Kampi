import { describe, expect, it, vi } from 'vitest';
import { PrismaClient, WalletLedgerType } from '@kampi/database';
import {
  mutateWallet,
  finalizeMatchPayout,
  refundAbortedMatch,
  WalletError,
} from './wallet.js';

// In-memory mock using real Prisma would need DB; use integration tests in CI.
// These unit tests validate idempotency logic with a lightweight mock.

function createMockPrisma() {
  const wallets = new Map<string, { id: string; userId: string; balance: bigint }>();
  const ledger = new Map<string, { id: string; balanceAfter: bigint; idempotencyKey: string }>();
  const matches = new Map<
    string,
    { id: string; status: string; payoutLedgerKey?: string; abortRefundKey?: string }
  >();
  let ledgerCounter = 0;

  const prisma = {
    wallet: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => {
        for (const w of wallets.values()) {
          if (w.userId === where.userId) return w;
        }
        return null;
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { userId: string };
          create: { userId: string; balance: bigint };
        }) => {
          for (const w of wallets.values()) {
            if (w.userId === where.userId) return w;
          }
          const wallet = { id: `w-${wallets.size + 1}`, userId: create.userId, balance: create.balance };
          wallets.set(wallet.id, wallet);
          return wallet;
        },
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { balance: bigint } }) => {
        const wallet = wallets.get(where.id);
        if (!wallet) throw new Error('wallet not found');
        wallet.balance = data.balance;
        return wallet;
      }),
    },
    walletLedgerEntry: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
        for (const entry of ledger.values()) {
          if (entry.idempotencyKey === where.idempotencyKey) return entry;
        }
        return null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
        for (const entry of ledger.values()) {
          if (entry.idempotencyKey === where.idempotencyKey) return entry;
        }
        throw new Error('not found');
      }),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            walletId: string;
            amount: bigint;
            balanceAfter: bigint;
            idempotencyKey: string;
          };
        }) => {
          if (ledger.has(data.idempotencyKey)) {
            const error = new Error('unique constraint') as Error & { code: string };
            error.code = 'P2002';
            throw error;
          }
          const entry = {
            id: `l-${++ledgerCounter}`,
            balanceAfter: data.balanceAfter,
            idempotencyKey: data.idempotencyKey,
          };
          ledger.set(data.idempotencyKey, entry);
          return entry;
        },
      ),
    },
    match: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => matches.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const match = matches.get(where.id);
        if (!match) throw new Error('match not found');
        Object.assign(match, data);
        return match;
      }),
    },
    matchPlayer: {
      findFirst: vi.fn(async () => ({ id: 'mp-1' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
  };

  return { prisma: prisma as unknown as PrismaClient, wallets, ledger, matches };
}

describe('mutateWallet idempotency', () => {
  it('returns duplicate result for same idempotency key', async () => {
    const { prisma, wallets } = createMockPrisma();
    wallets.set('w-1', { id: 'w-1', userId: 'u-1', balance: 10000n });

    const first = await mutateWallet(prisma, {
      userId: 'u-1',
      amount: -500n,
      type: WalletLedgerType.MATCH_ENTRY,
      idempotencyKey: 'entry:match:1:u-1',
    });
    const second = await mutateWallet(prisma, {
      userId: 'u-1',
      amount: -500n,
      type: WalletLedgerType.MATCH_ENTRY,
      idempotencyKey: 'entry:match:1:u-1',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.balance).toBe(first.balance);
  });

  it('throws on insufficient funds', async () => {
    const { prisma, wallets } = createMockPrisma();
    wallets.set('w-1', { id: 'w-1', userId: 'u-1', balance: 100n });

    await expect(
      mutateWallet(prisma, {
        userId: 'u-1',
        amount: -500n,
        type: WalletLedgerType.MATCH_ENTRY,
        idempotencyKey: 'entry:insufficient',
      }),
    ).rejects.toBeInstanceOf(WalletError);
  });
});

describe('finalizeMatchPayout', () => {
  it('enforces single payout', async () => {
    const { prisma, wallets, matches } = createMockPrisma();
    wallets.set('w-1', { id: 'w-1', userId: 'u-1', balance: 9000n });
    matches.set('m-1', { id: 'm-1', status: 'ACTIVE' });

    const first = await finalizeMatchPayout(prisma, {
      matchId: 'm-1',
      winnerUserId: 'u-1',
      payout: 950n,
      payoutLedgerKey: 'payout:m-1',
    });
    matches.set('m-1', {
      id: 'm-1',
      status: 'FINISHED',
      payoutLedgerKey: 'payout:m-1',
    });

    const second = await finalizeMatchPayout(prisma, {
      matchId: 'm-1',
      winnerUserId: 'u-1',
      payout: 950n,
      payoutLedgerKey: 'payout:m-1',
    });

    expect(first.paid).toBe(true);
    expect(second.paid).toBe(false);
  });
});

describe('refundAbortedMatch', () => {
  it('is idempotent via abortRefundKey', async () => {
    const { prisma, wallets, matches } = createMockPrisma();
    wallets.set('w-1', { id: 'w-1', userId: 'u-1', balance: 9000n });
    matches.set('m-1', { id: 'm-1', status: 'ACTIVE' });

    await refundAbortedMatch(prisma, {
      matchId: 'm-1',
      players: [{ userId: 'u-1', entryFeeKey: 'entry:m-1:u-1' }],
      entryFee: 500n,
      abortRefundKey: 'abort:m-1',
    });

    matches.set('m-1', { id: 'm-1', status: 'ABORTED', abortRefundKey: 'abort:m-1' });

    await expect(
      refundAbortedMatch(prisma, {
        matchId: 'm-1',
        players: [{ userId: 'u-1', entryFeeKey: 'entry:m-1:u-1' }],
        entryFee: 500n,
        abortRefundKey: 'abort:m-1',
      }),
    ).resolves.toBeUndefined();
  });
});
