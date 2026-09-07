import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { chipsToString } from '@kampi/contracts';
import { getPlayerStats, getWalletBalance } from '@kampi/domain';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async currentPlayer(@CurrentUser() user: AuthUser) {
    const [balance, stats] = await Promise.all([
      getWalletBalance(this.prisma, user.id),
      getPlayerStats(this.prisma, user.id),
    ]);
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      isGuest: user.isGuest,
      balance: chipsToString(balance),
      stats,
    };
  }
}
