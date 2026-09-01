import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AppConfigService } from '../config/app-config.service.js';
import { chipsToString } from '@kampi/contracts';

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  async listGames() {
    const games = await this.prisma.game.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, name: true, description: true },
    });
    return { games };
  }

  @Get(':slug/config')
  async gameConfig(@Param('slug') slug: string) {
    const game = await this.prisma.game.findUnique({
      where: { slug },
      include: {
        versions: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!game) {
      return { error: 'Game not found' };
    }

    const economy = this.config.economy;
    const version = game.versions[0];
    const versionConfig = (version?.config ?? {}) as Record<string, unknown>;

    return {
      slug: game.slug,
      name: game.name,
      entryFee: chipsToString(economy.rpsEntryFee),
      winnerPayout: chipsToString(economy.rpsWinnerPayout),
      bestOf: typeof versionConfig.bestOf === 'number' ? versionConfig.bestOf : 3,
      botFillAfterMs: economy.botFillAfterMs,
      reconnectGraceMs: economy.reconnectGraceMs,
    };
  }
}
