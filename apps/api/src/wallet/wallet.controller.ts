import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { getWalletBalance } from '@kampi/domain';
import { chipsToString } from '@kampi/contracts';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('balance')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async balance(@CurrentUser() user: { id: string }) {
    const balance = await getWalletBalance(this.prisma, user.id);
    return { balance: chipsToString(balance) };
  }

  @Get('ledger')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async ledger(
    @CurrentUser() user: { id: string },
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? 20), 100);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) {
      return { entries: [] };
    }

    const entries = await this.prisma.walletLedgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      entries: entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: chipsToString(entry.amount),
        balanceAfter: chipsToString(entry.balanceAfter),
        matchId: entry.matchId,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}
