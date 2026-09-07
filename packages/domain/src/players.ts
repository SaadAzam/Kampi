import { createHash, randomBytes } from 'node:crypto';
import { Prisma, PrismaClient, WalletLedgerType, AuditAction } from '@kampi/database';
import { getOrCreateWallet, mutateWallet } from './wallet.js';
import { displayNameFromEmail } from './auth.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ProvisionPlayerInput = {
  displayName?: string;
  email?: string | null;
  passwordHash?: string | null;
  isGuest: boolean;
  startingChips: bigint;
};

export async function provisionPlayer(prisma: PrismaClient, input: ProvisionPlayerInput) {
  const displayName =
    input.displayName?.trim() ||
    (input.email
      ? displayNameFromEmail(input.email)
      : `Guest ${Math.floor(Math.random() * 9000 + 1000)}`);

  const user = await prisma.user.create({
    data: {
      displayName,
      email: input.email ?? null,
      passwordHash: input.passwordHash ?? null,
      isGuest: input.isGuest,
      status: 'ACTIVE',
    },
  });

  await getOrCreateWallet(prisma, user.id);
  await mutateWallet(prisma, {
    userId: user.id,
    amount: input.startingChips,
    type: WalletLedgerType.STARTING_BALANCE,
    idempotencyKey: `starting:${user.id}`,
  });

  await prisma.auditLog.create({
    data: {
      action: AuditAction.USER_CREATED,
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
      metadata: { isGuest: input.isGuest },
    },
  });

  return user;
}

export function toAuthUser(user: {
  id: string;
  displayName: string;
  email: string | null;
  isGuest: boolean;
}) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    isGuest: user.isGuest,
  };
}

export async function issueSession(
  prisma: PrismaClient,
  userId: string,
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: AuditAction.SESSION_CREATED,
      actorId: userId,
      entityType: 'Session',
      entityId: userId,
    },
  });

  return token;
}

export async function claimGuestAccount(
  prisma: DbClient,
  input: {
    userId: string;
    email: string;
    passwordHash: string;
    displayName?: string;
  },
) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) {
    throw new PlayerAccountError('User not found', 'NOT_FOUND');
  }
  if (!user.isGuest) {
    throw new PlayerAccountError('Account is already registered', 'ALREADY_REGISTERED');
  }

  try {
    return await prisma.user.update({
      where: { id: input.userId, isGuest: true, status: 'ACTIVE' },
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        isGuest: false,
        displayName: input.displayName?.trim() || user.displayName,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new PlayerAccountError('Email is already in use', 'EMAIL_TAKEN');
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new PlayerAccountError('Account is already registered', 'ALREADY_REGISTERED');
    }
    throw error;
  }
}

export class PlayerAccountError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'ALREADY_REGISTERED' | 'EMAIL_TAKEN',
  ) {
    super(message);
    this.name = 'PlayerAccountError';
  }
}
