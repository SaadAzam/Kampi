import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { PrismaClient } from '@kampi/database';
import { AppConfigService } from '../config/app-config.service.js';

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get()
  async listGames() {
    const games = await this.prisma.game.findMany({
      where: { status: 'ACTIVE' },
      include: {
        versions: {
          where: { isActive: true },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      games: games.map((game) => {
        const versionConfig = (game.versions[0]?.config ?? {}) as Record<string, unknown>;
        return {
          id: game.id,
          slug: game.slug,
          name: game.name,
          description: game.description,
          clientUrl: this.resolveClientUrl(game.slug, versionConfig),
          entryFee:
            typeof versionConfig.entryFee === 'string'
              ? versionConfig.entryFee
              : this.config.economy.rpsEntryFee.toString(),
          winnerPayout:
            typeof versionConfig.winnerPayout === 'string'
              ? versionConfig.winnerPayout
              : this.config.economy.rpsWinnerPayout.toString(),
        };
      }),
    };
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
      throw new NotFoundException('Game not found');
    }

    const economy = this.config.economy;
    const version = game.versions[0];
    const versionConfig = (version?.config ?? {}) as Record<string, unknown>;

    return {
      slug: game.slug,
      name: game.name,
      entryFee:
        typeof versionConfig.entryFee === 'string'
          ? versionConfig.entryFee
          : economy.rpsEntryFee.toString(),
      winnerPayout:
        typeof versionConfig.winnerPayout === 'string'
          ? versionConfig.winnerPayout
          : economy.rpsWinnerPayout.toString(),
      bestOf: typeof versionConfig.bestOf === 'number' ? versionConfig.bestOf : undefined,
      regulationKicksPerPlayer:
        typeof versionConfig.regulationKicksPerPlayer === 'number'
          ? versionConfig.regulationKicksPerPlayer
          : undefined,
      decisionTimeMs:
        typeof versionConfig.decisionTimeMs === 'number'
          ? versionConfig.decisionTimeMs
          : undefined,
      botFillAfterMs:
        typeof versionConfig.botFillAfterMs === 'number'
          ? versionConfig.botFillAfterMs
          : economy.botFillAfterMs,
      reconnectGraceMs:
        typeof versionConfig.reconnectGraceMs === 'number'
          ? versionConfig.reconnectGraceMs
          : economy.reconnectGraceMs,
      clientUrl: this.resolveClientUrl(game.slug, versionConfig),
      version: version?.version ?? '1.0.0',
      config: versionConfig,
    };
  }

  private resolveClientUrl(slug: string, versionConfig: Record<string, unknown>): string {
    if (typeof versionConfig.clientLaunchUrl === 'string' && versionConfig.clientLaunchUrl) {
      return versionConfig.clientLaunchUrl;
    }
    if (slug === 'penalty-duel') {
      return process.env.GAME_PENALTY_PUBLIC_URL ?? 'http://localhost:5174';
    }
    return process.env.GAME_RPS_PUBLIC_URL ?? 'http://localhost:5173';
  }
}
