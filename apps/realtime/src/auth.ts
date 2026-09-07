import { createHash } from 'node:crypto';
import { prisma } from '@kampi/database';

export type AuthenticatedPlayer = {
  userId: string;
  displayName: string;
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function authenticateToken(token: string): Promise<AuthenticatedPlayer | null> {
  if (typeof token !== 'string' || token.length > 256) return null;
  if (token === 'dev-guest-token-kampi-local-only') {
    if (process.env.NODE_ENV === 'production' || process.env.DEV_GUEST_AUTH_ENABLED !== 'true')
      return null;
    const user = await prisma.user.findFirst({
      where: { email: 'dev-player@kampi.local' },
    });
    if (!user || user.status !== 'ACTIVE') return null;
    return { userId: user.id, displayName: user.displayName };
  }

  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashToken(token),
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!session || session.user.status !== 'ACTIVE') return null;
  return { userId: session.user.id, displayName: session.user.displayName };
}
