import {
  Prisma,
  PrismaClient,
  WalletLedgerType,
  MatchStatus,
  MatchPlayerResult,
} from '@kampi/database';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class WalletError extends Error {
  constructor(
    message: string,
    public readonly code: 'INSUFFICIENT_FUNDS' | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

export class MatchSettlementError extends Error {
  constructor(
    message: string,
    public readonly code: 'ALREADY_FINALIZED' | 'INVALID_STATE' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'MatchSettlementError';
  }
}

export type WalletMutationInput = {
  userId: string;
  amount: bigint;
  type: WalletLedgerType;
  idempotencyKey: string;
  matchId?: string;
  purchaseId?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function getOrCreateWallet(prisma: DbClient, userId: string) {
  return prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId, balance: 0n },
  });
}

export async function getWalletBalance(prisma: DbClient, userId: string): Promise<bigint> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  return wallet?.balance ?? 0n;
}

/** Idempotent wallet credit/debit. Negative amount debits. */
export async function mutateWallet(
  prisma: DbClient,
  input: WalletMutationInput,
): Promise<{ balance: bigint; ledgerEntryId: string; duplicate: boolean }> {
  const existing = await prisma.walletLedgerEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return {
      balance: existing.balanceAfter,
      ledgerEntryId: existing.id,
      duplicate: true,
    };
  }

  const runMutation = async (tx: DbClient) => {
    const wallet = await getOrCreateWallet(tx, input.userId);

    const newBalance = wallet.balance + input.amount;
    if (newBalance < 0n) {
      throw new WalletError('Insufficient chips', 'INSUFFICIENT_FUNDS');
    }

    try {
      const ledgerEntry = await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          type: input.type,
          amount: input.amount,
          balanceAfter: newBalance,
          idempotencyKey: input.idempotencyKey,
          matchId: input.matchId,
          purchaseId: input.purchaseId,
          metadata: input.metadata,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });

      return {
        balance: newBalance,
        ledgerEntryId: ledgerEntry.id,
        duplicate: false,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await tx.walletLedgerEntry.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return {
          balance: duplicate.balanceAfter,
          ledgerEntryId: duplicate.id,
          duplicate: true,
        };
      }
      throw error;
    }
  };

  if ('$transaction' in prisma && typeof prisma.$transaction === 'function') {
    return prisma.$transaction(async (tx) => runMutation(tx));
  }

  return runMutation(prisma);
}

export type DeductEntryFeesInput = {
  matchId: string;
  players: Array<{ userId: string; slot: number; entryFeeKey: string }>;
  entryFee: bigint;
};

export async function deductEntryFees(
  prisma: DbClient,
  input: DeductEntryFeesInput,
): Promise<void> {
  for (const player of input.players) {
    await mutateWallet(prisma, {
      userId: player.userId,
      amount: -input.entryFee,
      type: WalletLedgerType.MATCH_ENTRY,
      idempotencyKey: player.entryFeeKey,
      matchId: input.matchId,
      metadata: { slot: player.slot },
    });
  }
}

export type FinalizeMatchPayoutInput = {
  matchId: string;
  winnerUserId: string;
  payout: bigint;
  payoutLedgerKey: string;
};

export async function finalizeMatchPayout(
  prisma: DbClient,
  input: FinalizeMatchPayoutInput,
): Promise<{ paid: boolean }> {
  const match = await prisma.match.findUnique({ where: { id: input.matchId } });
  if (!match) throw new MatchSettlementError('Match not found', 'NOT_FOUND');
  if (match.status === MatchStatus.FINISHED && match.payoutLedgerKey) {
    return { paid: false };
  }
  if (match.status !== MatchStatus.RESOLVING && match.status !== MatchStatus.ACTIVE) {
    throw new MatchSettlementError(`Cannot payout match in status ${match.status}`, 'INVALID_STATE');
  }

  const result = await mutateWallet(prisma, {
    userId: input.winnerUserId,
    amount: input.payout,
    type: WalletLedgerType.MATCH_PAYOUT,
    idempotencyKey: input.payoutLedgerKey,
    matchId: input.matchId,
  });

  await prisma.match.update({
    where: { id: input.matchId },
    data: {
      status: MatchStatus.FINISHED,
      finalizedAt: new Date(),
      payoutLedgerKey: input.payoutLedgerKey,
      winnerPlayerId: (
        await prisma.matchPlayer.findFirst({
          where: { matchId: input.matchId, userId: input.winnerUserId },
        })
      )?.id,
    },
  });

  return { paid: !result.duplicate };
}

export type RefundAbortedMatchInput = {
  matchId: string;
  players: Array<{ userId: string; entryFeeKey: string }>;
  entryFee: bigint;
  abortRefundKey: string;
};

export async function refundAbortedMatch(
  prisma: PrismaClient,
  input: RefundAbortedMatchInput,
): Promise<void> {
  const match = await prisma.match.findUnique({ where: { id: input.matchId } });
  if (!match) throw new MatchSettlementError('Match not found', 'NOT_FOUND');
  if (match.abortRefundKey) return;

  await prisma.$transaction(async (tx) => {
    for (const player of input.players) {
      if (!player.userId) continue;
      await mutateWallet(tx, {
        userId: player.userId,
        amount: input.entryFee,
        type: WalletLedgerType.MATCH_REFUND,
        idempotencyKey: `${input.abortRefundKey}:${player.userId}`,
        matchId: input.matchId,
        metadata: { originalEntryKey: player.entryFeeKey },
      });
    }

    await tx.match.update({
      where: { id: input.matchId },
      data: {
        status: MatchStatus.ABORTED,
        abortRefundKey: input.abortRefundKey,
      },
    });

    await tx.matchPlayer.updateMany({
      where: { matchId: input.matchId },
      data: { result: MatchPlayerResult.ABORTED },
    });
  });
}

export interface PurchaseProvider {
  readonly name: string;
  createPendingPurchase(input: {
    userId: string;
    chipsAmount: bigint;
    idempotencyKey: string;
  }): Promise<{ purchaseId: string; externalRef?: string }>;
  completePurchase(purchaseId: string): Promise<void>;
}

export class ManualPurchaseProvider implements PurchaseProvider {
  readonly name = 'MANUAL';

  constructor(private readonly prisma: PrismaClient) {}

  async createPendingPurchase(input: {
    userId: string;
    chipsAmount: bigint;
    idempotencyKey: string;
  }) {
    const purchase = await this.prisma.purchase.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        userId: input.userId,
        provider: 'MANUAL',
        status: 'PENDING',
        chipsAmount: input.chipsAmount,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { purchaseId: purchase.id };
  }

  async completePurchase(purchaseId: string): Promise<void> {
    const purchase = await this.prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (purchase.status === 'COMPLETED') return;

    await this.prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: 'COMPLETED' },
      });
      await mutateWallet(tx, {
        userId: purchase.userId,
        amount: purchase.chipsAmount,
        type: WalletLedgerType.PURCHASE_CREDIT,
        idempotencyKey: `purchase:${purchaseId}:credit`,
        purchaseId,
      });
    });
  }
}
