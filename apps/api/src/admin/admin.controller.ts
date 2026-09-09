import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  BadRequestException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@kampi/database';
import { mutateWallet, WalletError } from '@kampi/domain';
import { PRISMA } from '../database/database.module.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { parseBody } from '../common/parse-body.js';
import { AdminGuard, isAdmin } from './admin.guard.js';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  search: z.string().trim().max(100).default(''),
});
const idSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(5).max(500);
const userSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  isGuest: true,
  createdAt: true,
} as const;
const json = <T>(value: T): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  @Get('me') me(@CurrentUser() user: AuthUser) {
    return { user };
  }

  @Get('overview') async overview() {
    const since = new Date(Date.now() - 7 * 86400000);
    const [
      players,
      guests,
      suspended,
      matches,
      byStatus,
      byGame,
      wallets,
      ledger,
      progression,
      recent,
      daily,
    ] = await Promise.all([
      this.db.user.count(),
      this.db.user.count({ where: { isGuest: true } }),
      this.db.user.count({ where: { status: 'SUSPENDED' } }),
      this.db.match.count(),
      this.db.match.groupBy({ by: ['status'], _count: true }),
      this.db.game.findMany({
        select: { name: true, slug: true, status: true, _count: { select: { matches: true } } },
      }),
      this.db.wallet.aggregate({ _sum: { balance: true } }),
      this.db.walletLedgerEntry.groupBy({ by: ['type'], _count: true, _sum: { amount: true } }),
      this.db.playerProgression.aggregate({ _sum: { wins: true, losses: true, xp: true } }),
      this.db.match.count({ where: { createdAt: { gte: since } } }),
      this.db.$queryRaw<
        Array<{ day: string; matches: bigint }>
      >`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS matches FROM "Match" WHERE "createdAt" >= ${since} GROUP BY day ORDER BY day`,
    ]);
    return json({
      players,
      guests,
      suspended,
      matches,
      byStatus,
      byGame,
      chipsInWallets: wallets._sum.balance ?? 0n,
      ledger,
      progression: progression._sum,
      matchesLast7Days: recent,
      daily,
    });
  }

  @Get('players') async players(@Query() query: unknown) {
    const { page, search } = parseBody(pageSchema, query);
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            ...(idSchema.safeParse(search).success ? [{ id: search }] : []),
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: {
          ...userSelect,
          wallet: { select: { balance: true } },
          progression: { include: { game: { select: { name: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        skip: (page - 1) * 25,
      }),
      this.db.user.count({ where }),
    ]);
    return json({ items, total, page });
  }

  @Post('players/:id/status') async playerStatus(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
  ) {
    const id = parseBody(idSchema, rawId);
    const input = parseBody(
      z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: reasonSchema }),
      body,
    );
    if (id === actor.id || isAdmin({ ...actor, id }))
      throw new BadRequestException('Admin accounts cannot be suspended here');
    await this.db.$transaction(async (tx) => {
      const player = await tx.user.findUnique({ where: { id }, select: { status: true } });
      if (!player || player.status === 'DELETED') throw new NotFoundException('Player not found');
      await tx.user.update({ where: { id }, data: { status: input.status } });
      if (input.status === 'SUSPENDED')
        await tx.session.updateMany({
          where: { userId: id, status: 'ACTIVE' },
          data: { status: 'REVOKED' },
        });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'ADMIN_ACTION',
          entityType: 'User',
          entityId: id,
          metadata: { operation: 'status', before: player.status, ...input },
        },
      });
    });
    return { ok: true };
  }

  @Post('players/:id/adjustment') async adjustment(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
  ) {
    const id = parseBody(idSchema, rawId);
    const input = parseBody(
      z.object({
        amount: z.string().regex(/^-?[1-9]\d{0,8}$/),
        reason: reasonSchema,
        commandId: z.string().uuid(),
      }),
      body,
    );
    const result = await this.db
      .$transaction(async (tx) => {
        if (!(await tx.user.findUnique({ where: { id }, select: { id: true } })))
          throw new NotFoundException('Player not found');
        const result = await mutateWallet(tx, {
          userId: id,
          amount: BigInt(input.amount),
          type: 'ADMIN_ADJUSTMENT',
          idempotencyKey: `admin:${actor.id}:${input.commandId}`,
          metadata: { actorId: actor.id, reason: input.reason },
        });
        if (!result.duplicate)
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: 'ADMIN_ACTION',
              entityType: 'Wallet',
              entityId: id,
              metadata: { operation: 'adjustment', ...input },
            },
          });
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof WalletError) throw new BadRequestException(error.message);
        throw error;
      });
    return json(result);
  }

  @Get('matches') async matches(@Query() query: unknown) {
    const { page, search } = parseBody(pageSchema, query);
    const where: Prisma.MatchWhereInput = search
      ? {
          OR: [
            { game: { name: { contains: search, mode: 'insensitive' } } },
            { players: { some: { displayName: { contains: search, mode: 'insensitive' } } } },
            ...(idSchema.safeParse(search).success ? [{ id: search }] : []),
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.db.match.findMany({
        where,
        include: { game: { select: { name: true } }, players: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        skip: (page - 1) * 25,
      }),
      this.db.match.count({ where }),
    ]);
    return json({ items, total, page });
  }

  @Get('matches/:id') async match(@Param('id') rawId: string) {
    const id = parseBody(idSchema, rawId);
    const match = await this.db.match.findUnique({
      where: { id },
      include: {
        game: { select: { name: true } },
        players: true,
        events: { orderBy: { createdAt: 'asc' }, take: 500 },
        ledgerEntries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    return json(match);
  }

  @Get('wallet') async wallet(@Query() query: unknown) {
    const { page, search } = parseBody(pageSchema, query);
    const where: Prisma.WalletLedgerEntryWhereInput = search
      ? {
          OR: [
            { wallet: { user: { displayName: { contains: search, mode: 'insensitive' } } } },
            { idempotencyKey: { contains: search } },
            ...(idSchema.safeParse(search).success
              ? [{ matchId: search }, { wallet: { userId: search } }]
              : []),
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.db.walletLedgerEntry.findMany({
        where,
        include: { wallet: { select: { user: { select: userSelect } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        skip: (page - 1) * 25,
      }),
      this.db.walletLedgerEntry.count({ where }),
    ]);
    return json({ items, total, page });
  }

  @Get('games') async games() {
    return json({
      items: await this.db.game.findMany({
        include: { versions: true, _count: { select: { matches: true } } },
        orderBy: { name: 'asc' },
      }),
    });
  }

  @Post('games/:id/status') async gameStatus(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
  ) {
    const id = parseBody(idSchema, rawId);
    const input = parseBody(
      z.object({ status: z.enum(['ACTIVE', 'DRAFT']), reason: reasonSchema }),
      body,
    );
    await this.db.$transaction(async (tx) => {
      const game = await tx.game.findUnique({ where: { id } });
      if (!game) throw new NotFoundException('Game not found');
      await tx.game.update({ where: { id }, data: { status: input.status } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'ADMIN_ACTION',
          entityType: 'Game',
          entityId: id,
          metadata: { before: game.status, ...input },
        },
      });
    });
    return { ok: true };
  }

  @Get('audit') async audit(@Query() query: unknown) {
    const { page } = parseBody(pageSchema, query);
    const where = { action: 'ADMIN_ACTION' as const };
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        include: { actor: { select: userSelect } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        skip: (page - 1) * 25,
      }),
      this.db.auditLog.count({ where }),
    ]);
    return json({ items, total, page });
  }

  @Get('health') async health() {
    const results = await Promise.all(
      ['API_PUBLIC_URL', 'REALTIME_PUBLIC_URL'].map(async (key) => {
        const url = process.env[key]?.replace(/^ws/, 'http');
        if (!url) return { service: key, status: 'unconfigured' };
        try {
          const res = await fetch(`${url}/health/ready`, { signal: AbortSignal.timeout(5000) });
          return {
            service: key === 'API_PUBLIC_URL' ? 'API + PostgreSQL' : 'Realtime',
            status: res.ok ? 'ready' : 'unavailable',
          };
        } catch {
          return { service: key, status: 'unavailable' };
        }
      }),
    );
    return { items: results, checkedAt: new Date().toISOString() };
  }
}
