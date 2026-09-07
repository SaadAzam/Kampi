import { describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient, WalletLedgerType } from '@kampi/database';
import {
  mutateWallet,
  finalizeMatchPayout,
  refundAbortedMatch,
  WalletError,
  deductEntryFees,
} from './wallet.js';

// In-memory mock using real Prisma would need DB; use integration tests in CI.
// These unit tests validate idempotency logic with a lightweight mock.

function createMockPrisma() {
  const wallets = new Map<string, { id: string; userId: string; balance: bigint }>();
  const ledger = new Map<
    string,
    {
      id: string;
      balanceAfter: bigint;
      idempotencyKey: string;
      walletId: string;
      amount: bigint;
      type: WalletLedgerType;
      matchId: string | null;
      purchaseId: string | null;
    }
  >();
  const matches = new Map<
    string,
    {
      id: string;
      status: string;
      payoutLedgerKey?: string;
      abortRefundKey?: string;
      entryFee?: bigint;
      winnerPayout?: bigint;
    }
  >();
  let ledgerCounter = 0;

  const prisma = {
    $queryRaw: vi.fn(async () => []),
    wallet: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const wallet = [...wallets.values()].find((w) => w.userId === where.userId);
        if (!wallet) throw new Error('Wallet missing');
        return wallet;
      }),
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
          const wallet = {
            id: `w-${wallets.size + 1}`,
            userId: create.userId,
            balance: create.balance,
          };
          wallets.set(wallet.id, wallet);
          return wallet;
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { balance: bigint } }) => {
          const wallet = wallets.get(where.id);
          if (!wallet) throw new Error('wallet not found');
          wallet.balance = data.balance;
          return wallet;
        },
      ),
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
            type: WalletLedgerType;
            matchId?: string;
            purchaseId?: string;
          };
        }) => {
          if (ledger.has(data.idempotencyKey)) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
              meta: { target: ['idempotencyKey'] },
            });
          }
          const entry = {
            id: `l-${++ledgerCounter}`,
            balanceAfter: data.balanceAfter,
            idempotencyKey: data.idempotencyKey,
            walletId: data.walletId,
            amount: data.amount,
            type: data.type,
            matchId: data.matchId ?? null,
            purchaseId: data.purchaseId ?? null,
          };
          ledger.set(data.idempotencyKey, entry);
          return entry;
        },
      ),
    },
    match: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => matches.get(where.id) ?? null,
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const match = matches.get(where.id);
          if (!match) throw new Error('match not found');
          Object.assign(match, data);
          return match;
        },
      ),
    },
    matchPlayer: {
      findFirst: vi.fn(async () => ({ id: 'mp-1' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(
      async (fn: (tx: Omit<typeof prisma, '$transaction'>) => Promise<unknown>) => {
        const { $transaction: _transaction, ...tx } = prisma;
        void _transaction;
        return fn(tx);
      },
    ),
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

  it('rejects reuse of a key with a different amount', async () => {
    const { prisma, wallets } = createMockPrisma();
    wallets.set('w-1', { id: 'w-1', userId: 'u-1', balance: 1000n });
    const input = {
      userId: 'u-1',
      amount: -100n,
      type: WalletLedgerType.MATCH_ENTRY,
      idempotencyKey: 'one',
    };
    await mutateWallet(prisma, input);
    await expect(mutateWallet(prisma, { ...input, amount: 100n })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(wallets.get('w-1')?.balance).toBe(900n);
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
    matches.set('m-1', { id: 'm-1', status: 'ACTIVE', entryFee: 500n, winnerPayout: 950n });

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
    matches.set('m-1', { id: 'm-1', status: 'ACTIVE', entryFee: 500n, winnerPayout: 950n });

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

describe('settlement abuse prevention', () => {
  it('does not mint chips when aborting before an entry debit', async () => {
    const { prisma, wallets, matches, ledger } = createMockPrisma();
    wallets.set('w-1', { id: 'w-1', userId: 'u-1', balance: 100n });
    matches.set('m-1', { id: 'm-1', status: 'WAITING', entryFee: 500n });
    await refundAbortedMatch(prisma, {
      matchId: 'm-1',
      players: [{ userId: 'u-1', entryFeeKey: 'missing' }],
      entryFee: 500n,
      abortRefundKey: 'abort:m-1',
    });
    expect(wallets.get('w-1')?.balance).toBe(100n);
    expect(ledger.size).toBe(0);
  });

  it('refunds the actual debit, ignoring a caller-supplied refund amount', async () => {
    const { prisma, wallets, matches } = createMockPrisma();
    wallets.set('w-1', { id: 'w-1', userId: 'u-1', balance: 1000n });
    matches.set('m-1', { id: 'm-1', status: 'WAITING', entryFee: 500n });
    await deductEntryFees(prisma, {
      matchId: 'm-1',
      players: [{ userId: 'u-1', slot: 1, entryFeeKey: 'entry:m-1:u-1' }],
      entryFee: 500n,
    });
    await refundAbortedMatch(prisma, {
      matchId: 'm-1',
      players: [{ userId: 'u-1', entryFeeKey: 'entry:m-1:u-1' }],
      entryFee: 999999n,
      abortRefundKey: 'abort:m-1',
    });
    expect(wallets.get('w-1')?.balance).toBe(1000n);
  });

  it('rejects refunds after a finished match', async () => {
    const { prisma, matches } = createMockPrisma();
    matches.set('m-1', { id: 'm-1', status: 'FINISHED' });
    await expect(
      refundAbortedMatch(prisma, {
        matchId: 'm-1',
        players: [],
        entryFee: 500n,
        abortRefundKey: 'abort:m-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects a payout different from the stored economy', async () => {
    const { prisma, matches } = createMockPrisma();
    matches.set('m-1', { id: 'm-1', status: 'ACTIVE', winnerPayout: 950n });
    await expect(
      finalizeMatchPayout(prisma, {
        matchId: 'm-1',
        winnerUserId: 'u-1',
        payout: 99999n,
        payoutLedgerKey: 'payout:m-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
