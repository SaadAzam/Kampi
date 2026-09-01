import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { getWalletBalance } from '@kampi/domain';
import { chipsToString } from '@kampi/contracts';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async currentPlayer(@CurrentUser() user: { id: string; displayName: string; isGuest: boolean }) {
    const balance = await getWalletBalance(this.prisma, user.id);
    return {
      id: user.id,
      displayName: user.displayName,
      isGuest: user.isGuest,
      balance: chipsToString(balance),
    };
  }
}
