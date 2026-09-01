import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@ApiTags('matches')
@Controller('matches')
export class MatchesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('history')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async history(
    @CurrentUser() user: { id: string },
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? 20), 100);
    const players = await this.prisma.matchPlayer.findMany({
      where: { userId: user.id },
      include: {
        match: {
          include: { game: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      matches: players.map((player) => ({
        matchId: player.matchId,
        gameSlug: player.match.game.slug,
        status: player.match.status,
        result: player.result,
        score: player.score,
        createdAt: player.createdAt.toISOString(),
      })),
      note: 'Match history placeholder — detailed round data available via match events',
    };
  }
}
