import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AppConfigService } from '../config/app-config.service.js';
import { hashToken } from './auth.utils.js';

export type AuthUser = {
  id: string;
  displayName: string;
  email: string | null;
  isGuest: boolean;
};

export type AuthenticatedRequest = {
  user?: AuthUser;
  headers: Record<string, string | string[] | undefined>;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token || token.length > 256) {
      throw new UnauthorizedException('Missing bearer token');
    }

    if (
      token === 'dev-guest-token-kampi-local-only' &&
      (this.config.nodeEnv === 'production' || !this.config.devGuestAuthEnabled)
    ) {
      throw new UnauthorizedException('Development token is disabled');
    }

    if (this.config.devGuestAuthEnabled && token === 'dev-guest-token-kampi-local-only') {
      const user = await this.prisma.user.findFirst({
        where: { email: 'dev-player@kampi.local' },
      });
      if (user && user.status === 'ACTIVE') {
        request.user = {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
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
      email: session.user.email,
      isGuest: session.user.isGuest,
    };
    return true;
  }
}
