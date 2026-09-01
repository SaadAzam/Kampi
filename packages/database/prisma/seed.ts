import { createHash, randomBytes } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import {
  PrismaClient,
  WalletLedgerType,
  PurchaseProvider,
  PurchaseStatus,
} from '@prisma/client';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv();

const prisma = new PrismaClient();

export const DEV_PLAYER_ID = '00000000-0000-4000-8000-000000000001';
export const DEV_PLAYER_EMAIL = 'dev-player@kampi.local';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

async function main() {
  const startingChips = BigInt(process.env.STARTING_CHIPS ?? '10000');

  const rpsGame = await prisma.game.upsert({
    where: { slug: 'rock-paper-scissors' },
    update: {
      name: 'Rock Paper Scissors',
      status: 'ACTIVE',
    },
    create: {
      slug: 'rock-paper-scissors',
      name: 'Rock Paper Scissors',
      status: 'ACTIVE',
      description: 'Best-of-three Rock Paper Scissors',
    },
  });

  await prisma.gameVersion.upsert({
    where: {
      gameId_version: {
        gameId: rpsGame.id,
        version: '1.0.0',
      },
    },
    update: {
      isActive: true,
      config: {
        bestOf: 3,
        entryFee: process.env.RPS_ENTRY_FEE ?? '500',
        winnerPayout: process.env.RPS_WINNER_PAYOUT ?? '950',
        roundTimeoutMs: 15000,
      },
    },
    create: {
      gameId: rpsGame.id,
      version: '1.0.0',
      isActive: true,
      config: {
        bestOf: 3,
        entryFee: process.env.RPS_ENTRY_FEE ?? '500',
        winnerPayout: process.env.RPS_WINNER_PAYOUT ?? '950',
        roundTimeoutMs: 15000,
      },
    },
  });

  const devUser = await prisma.user.upsert({
    where: { id: DEV_PLAYER_ID },
    update: {
      displayName: 'Dev Player',
      email: DEV_PLAYER_EMAIL,
      status: 'ACTIVE',
      isGuest: true,
    },
    create: {
      id: DEV_PLAYER_ID,
      displayName: 'Dev Player',
      email: DEV_PLAYER_EMAIL,
      status: 'ACTIVE',
      isGuest: true,
    },
  });

  const wallet = await prisma.wallet.upsert({
    where: { userId: devUser.id },
    update: {},
    create: {
      userId: devUser.id,
      balance: startingChips,
    },
  });

  const existingStarting = await prisma.walletLedgerEntry.findUnique({
    where: { idempotencyKey: 'seed:dev-player:starting-balance' },
  });

  if (!existingStarting) {
    await prisma.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: WalletLedgerType.STARTING_BALANCE,
        amount: startingChips,
        balanceAfter: startingChips,
        idempotencyKey: 'seed:dev-player:starting-balance',
        metadata: { source: 'seed' },
      },
    });
  }

  const devToken = 'dev-guest-token-kampi-local-only';
  const tokenHash = hashToken(devToken);

  await prisma.session.upsert({
    where: { tokenHash },
    update: {
      userId: devUser.id,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    create: {
      userId: devUser.id,
      tokenHash,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.playerProgression.upsert({
    where: {
      userId_gameId: {
        userId: devUser.id,
        gameId: rpsGame.id,
      },
    },
    update: {},
    create: {
      userId: devUser.id,
      gameId: rpsGame.id,
    },
  });

  // Placeholder purchase provider interface seed
  await prisma.purchase.upsert({
    where: { idempotencyKey: 'seed:placeholder-purchase' },
    update: {},
    create: {
      userId: devUser.id,
      provider: PurchaseProvider.MANUAL,
      status: PurchaseStatus.PENDING,
      chipsAmount: 1000n,
      currencyCode: 'USD',
      idempotencyKey: 'seed:placeholder-purchase',
      metadata: { note: 'Placeholder pending purchase for future provider integration' },
    },
  });

  console.info('Seed complete');
  console.info(`Dev player ID: ${devUser.id}`);
  console.info(`Dev guest token: ${devToken}`);
  console.info(`RPS game ID: ${rpsGame.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
