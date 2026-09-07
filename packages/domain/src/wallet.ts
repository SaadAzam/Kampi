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

/** Every financial operation runs in one transaction; nested callers reuse theirs. */
async function atomic<T>(
  db: DbClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ('$transaction' in db) return db.$transaction(run);
  return run(db);
}

async function lockMatch(tx: Prisma.TransactionClient, matchId: string) {
  await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId}::uuid FOR UPDATE`;
  const match = await tx.match.findUnique({ where: { id: matchId } });
  if (!match) throw new MatchSettlementError('Match not found', 'NOT_FOUND');
  return match;
}

/** Serialize on the wallet row, so distinct concurrent debits cannot spend the same chips. */
export async function mutateWallet(
  db: DbClient,
  input: WalletMutationInput,
): Promise<{
  balance: bigint;
  ledgerEntryId: string;
  duplicate: boolean;
}> {
  return atomic(db, async (tx) => {
    const initial = await getOrCreateWallet(tx, input.userId);
    await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${initial.id}::uuid FOR UPDATE`;
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: input.userId } });
    const existing = await tx.walletLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (
        existing.walletId !== wallet.id ||
        existing.amount !== input.amount ||
        existing.type !== input.type ||
        existing.matchId !== (input.matchId ?? null) ||
        existing.purchaseId !== (input.purchaseId ?? null)
      ) {
        throw new WalletError(
          'Idempotency key belongs to a different mutation',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      return { balance: existing.balanceAfter, ledgerEntryId: existing.id, duplicate: true };
    }
    const balance = wallet.balance + input.amount;
    if (balance < 0n) throw new WalletError('Insufficient chips', 'INSUFFICIENT_FUNDS');
    const entry = await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        amount: input.amount,
        balanceAfter: balance,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
        matchId: input.matchId,
        purchaseId: input.purchaseId,
        metadata: input.metadata,
      },
    });
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
    return { balance, ledgerEntryId: entry.id, duplicate: false };
  });
}

export type DeductEntryFeesInput = {
  matchId: string;
  players: Array<{ userId: string; slot: number; entryFeeKey: string }>;
  entryFee: bigint;
};

export async function deductEntryFees(db: DbClient, input: DeductEntryFeesInput): Promise<void> {
  await atomic(db, async (tx) => {
    const match = await lockMatch(tx, input.matchId);
    if (
      match.status !== MatchStatus.WAITING ||
      input.entryFee < 0n ||
      match.entryFee !== input.entryFee
    ) {
      throw new MatchSettlementError('Invalid match entry', 'INVALID_STATE');
    }
    // Stable order also prevents lock inversion between concurrent matches.
    for (const player of [...input.players].sort((a, b) => a.userId.localeCompare(b.userId))) {
      const seat = await tx.matchPlayer.findFirst({
        where: {
          matchId: input.matchId,
          userId: player.userId,
          slot: player.slot,
          kind: 'HUMAN',
          entryFeeKey: player.entryFeeKey,
        },
      });
      if (!seat) throw new MatchSettlementError('Player is not in match', 'INVALID_STATE');
      await mutateWallet(tx, {
        userId: player.userId,
        amount: -input.entryFee,
        type: WalletLedgerType.MATCH_ENTRY,
        idempotencyKey: player.entryFeeKey,
        matchId: input.matchId,
        metadata: { slot: player.slot },
      });
    }
  });
}

export type FinalizeMatchPayoutInput = {
  matchId: string;
  winnerUserId: string;
  payout: bigint;
  payoutLedgerKey: string;
};

export async function finalizeMatchPayout(
  db: DbClient,
  input: FinalizeMatchPayoutInput,
): Promise<{ paid: boolean }> {
  return atomic(db, async (tx) => {
    const match = await lockMatch(tx, input.matchId);
    if (match.status === MatchStatus.FINISHED) return { paid: false };
    if (
      ![MatchStatus.ACTIVE, MatchStatus.RESOLVING].some((status) => status === match.status) ||
      input.payout < 0n ||
      input.payout !== match.winnerPayout
    ) {
      throw new MatchSettlementError('Invalid match payout', 'INVALID_STATE');
    }
    const winner = await tx.matchPlayer.findFirst({
      where: {
        matchId: input.matchId,
        userId: input.winnerUserId,
        kind: 'HUMAN',
      },
    });
    if (!winner) throw new MatchSettlementError('Winner is not in match', 'INVALID_STATE');
    const result = await mutateWallet(tx, {
      userId: input.winnerUserId,
      amount: input.payout,
      type: WalletLedgerType.MATCH_PAYOUT,
      idempotencyKey: input.payoutLedgerKey,
      matchId: input.matchId,
    });
    await tx.match.update({
      where: { id: input.matchId },
      data: {
        status: MatchStatus.FINISHED,
        finalizedAt: new Date(),
        payoutLedgerKey: input.payoutLedgerKey,
        winnerPlayerId: winner.id,
      },
    });
    return { paid: !result.duplicate };
  });
}

export type RefundAbortedMatchInput = {
  matchId: string;
  players: Array<{ userId: string; entryFeeKey: string }>;
  entryFee: bigint;
  abortRefundKey: string;
};

export async function refundAbortedMatch(
  db: DbClient,
  input: RefundAbortedMatchInput,
): Promise<void> {
  await atomic(db, async (tx) => {
    const match = await lockMatch(tx, input.matchId);
    if (match.abortRefundKey) return;
    if (match.status === MatchStatus.FINISHED) {
      throw new MatchSettlementError('Cannot refund a finished match', 'INVALID_STATE');
    }
    for (const player of [...input.players].sort((a, b) => a.userId.localeCompare(b.userId))) {
      const entry = await tx.walletLedgerEntry.findUnique({
        where: { idempotencyKey: player.entryFeeKey },
      });
      // Refund only an actual debit belonging to this player and match.
      if (
        !entry ||
        entry.type !== WalletLedgerType.MATCH_ENTRY ||
        entry.matchId !== input.matchId ||
        entry.amount >= 0n
      )
        continue;
      const wallet = await tx.wallet.findUnique({ where: { userId: player.userId } });
      if (!wallet || wallet.id !== entry.walletId)
        throw new MatchSettlementError('Invalid refund owner', 'INVALID_STATE');
      await mutateWallet(tx, {
        userId: player.userId,
        amount: -entry.amount,
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
        finalizedAt: new Date(),
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
