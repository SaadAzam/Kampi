import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma, type PrismaClient } from '@kampi/database';
import {
  ClaimAccountRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
} from '@kampi/contracts';
import {
  GUEST_SESSION_TTL_MS,
  REGISTERED_SESSION_TTL_MS,
  claimGuestAccount,
  hashPassword,
  issueSession,
  PlayerAccountError,
  provisionPlayer,
  toAuthUser,
  verifyPassword,
} from '@kampi/domain';
import { PRISMA } from '../database/database.module.js';
import { AppConfigService } from '../config/app-config.service.js';
import { parseBody } from '../common/parse-body.js';
import { hashToken } from './auth.utils.js';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { CurrentUser, type AuthUser } from './current-user.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get('config')
  authConfig() {
    return { guestAuthEnabled: this.config.devGuestAuthEnabled };
  }

  @Post('guest')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async guestLogin() {
    if (!this.config.devGuestAuthEnabled) {
      throw new ForbiddenException('Guest authentication is disabled');
    }

    const user = await provisionPlayer(this.prisma, {
      isGuest: true,
      startingChips: this.config.economy.startingChips,
    });
    const token = await issueSession(this.prisma, user.id, GUEST_SESSION_TTL_MS);

    return {
      token,
      user: toAuthUser(user),
    };
  }

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(@Body() body: unknown) {
    const input = parseBody(RegisterRequestSchema, body);

    try {
      const user = await provisionPlayer(this.prisma, {
        email: input.email,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
        isGuest: false,
        startingChips: this.config.economy.startingChips,
      });
      const token = await issueSession(this.prisma, user.id, REGISTERED_SESSION_TTL_MS);
      return { token, user: toAuthUser(user) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email is already in use');
      }
      throw error;
    }
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: unknown) {
    const input = parseBody(LoginRequestSchema, body);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = await issueSession(this.prisma, user.id, REGISTERED_SESSION_TTL_MS);
    return { token, user: toAuthUser(user) };
  }

  @Post('claim')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async claim(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    const input = parseBody(ClaimAccountRequestSchema, body);
    try {
      const user = await claimGuestAccount(this.prisma, {
        userId: actor.id,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName,
      });
      const token = await issueSession(this.prisma, user.id, REGISTERED_SESSION_TTL_MS);
      return { token, user: toAuthUser(user) };
    } catch (error) {
      if (error instanceof PlayerAccountError) {
        if (error.code === 'EMAIL_TAKEN') throw new ConflictException(error.message);
        if (error.code === 'ALREADY_REGISTERED') throw new ForbiddenException(error.message);
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async logout(@Req() request: AuthenticatedRequest) {
    const token = bearerToken(request);
    if (token) {
      await this.prisma.session.updateMany({
        where: { tokenHash: hashToken(token), status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
    }
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}

function bearerToken(request: AuthenticatedRequest): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}
