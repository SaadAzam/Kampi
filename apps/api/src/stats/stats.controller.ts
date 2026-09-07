import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PrismaClient } from '@kampi/database';
import { LeaderboardQuerySchema } from '@kampi/contracts';
import { getLeaderboards, getPlayerStats } from '@kampi/domain';
import { PRISMA } from '../database/database.module.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../common/parse-body.js';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async myStats(@CurrentUser() user: AuthUser) {
    return getPlayerStats(this.prisma, user.id);
  }

  @Get('leaderboard')
  async leaderboard(
    @Query('gameSlug') gameSlug?: string,
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    const query = parseBody(LeaderboardQuerySchema, {
      ...(gameSlug ? { gameSlug } : {}),
      ...(period ? { period } : {}),
      ...(limit ? { limit } : {}),
    });
    return getLeaderboards(this.prisma, query);
  }
}
