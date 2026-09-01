import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WalletLedgerType, type PrismaClient } from '@kampi/database';
import { getOrCreateWallet, mutateWallet } from '@kampi/domain';
import { PRISMA } from '../database/database.module.js';
import { AppConfigService } from '../config/app-config.service.js';
import { createSessionToken, hashToken } from './auth.utils.js';
import { AuthGuard } from './auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly config: AppConfigService,
  ) {}

  @Post('guest')
  async guestLogin() {
    if (!this.config.devGuestAuthEnabled) {
      throw new ForbiddenException('Guest authentication is disabled');
    }

    const displayName = `Guest ${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = await this.prisma.user.create({
      data: {
        displayName,
        isGuest: true,
        status: 'ACTIVE',
      },
    });

    const token = createSessionToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await getOrCreateWallet(this.prisma, user.id);
    await mutateWallet(this.prisma, {
      userId: user.id,
      amount: this.config.economy.startingChips,
      type: WalletLedgerType.STARTING_BALANCE,
      idempotencyKey: `starting:${user.id}`,
    });

    return {
      token,
      user: {
        id: user.id,
        displayName: user.displayName,
        isGuest: user.isGuest,
      },
    };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: { id: string; displayName: string; isGuest: boolean }) {
    return { user };
  }
}
