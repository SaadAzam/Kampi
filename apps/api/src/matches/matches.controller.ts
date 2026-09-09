import { z } from 'zod';
import { parseBody } from '../common/parse-body.js';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';

@ApiTags('matches')
@Controller('matches')
export class MatchesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('history')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async history(@CurrentUser() user: AuthUser, @Query('limit') limitRaw?: string) {
    const limit = parseBody(z.coerce.number().int().min(1).max(100), limitRaw ?? 20);
    const players = await this.prisma.matchPlayer.findMany({
      where: { userId: user.id },
      include: {
        match: {
          include: { game: true, players: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      matches: players.map((player) => ({
        matchId: player.matchId,
        gameSlug: player.match.game.slug,
        gameName: player.match.game.name,
        opponent:
          player.match.players.find((opponent) => opponent.slot !== player.slot)?.displayName ??
          'Opponent',
        opponentScore:
          player.match.players.find((opponent) => opponent.slot !== player.slot)?.score ?? 0,
        botFill: player.match.botFill,
        finalizedAt: player.match.finalizedAt?.toISOString() ?? null,
        status: player.match.status,
        result: player.result,
        score: player.score,
        createdAt: player.createdAt.toISOString(),
      })),
    };
  }
}
