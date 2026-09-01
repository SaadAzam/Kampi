import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AppConfigService } from '../config/app-config.service.js';

export type AuthenticatedRequest = {
  user?: {
    id: string;
    displayName: string;
    isGuest: boolean;
  };
  headers: Record<string, string | string[] | undefined>;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    // Development guest token shortcut
    if (
      this.config.devGuestAuthEnabled &&
      token === 'dev-guest-token-kampi-local-only'
    ) {
      const user = await this.prisma.user.findFirst({
        where: { email: 'dev-player@kampi.local' },
      });
      if (user) {
        request.user = {
          id: user.id,
          displayName: user.displayName,
          isGuest: user.isGuest,
        };
        return true;
      }
    }

    const session = await this.prisma.session.findFirst({
      where: {
        tokenHash: hashToken(token),
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!session || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid or expired session');
    }

    request.user = {
      id: session.user.id,
      displayName: session.user.displayName,
      isGuest: session.user.isGuest,
    };
    return true;
  }
}
