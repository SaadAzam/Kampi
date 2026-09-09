import { afterAll, beforeAll, expect, it } from 'vitest';
import { prisma } from '@kampi/database';
import { AdminController } from './admin.controller.js';
const enabled = process.env.KAMPI_DB_INTEGRATION === '1';
const actor = {
  id: crypto.randomUUID(),
  displayName: 'Admin regression',
  email: 'admin-test@kampi.local',
  isGuest: false,
};
const playerId = crypto.randomUUID();
const gameId = crypto.randomUUID();
let previousIds: string | undefined;
beforeAll(async () => {
  if (!enabled) return;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname))
    throw new Error('Admin integration tests require local PostgreSQL');
  previousIds = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = actor.id;
  await prisma.user.create({ data: { id: actor.id, displayName: actor.displayName } });
  await prisma.user.create({
    data: {
      id: playerId,
      displayName: 'Admin regression player',
      wallet: { create: { balance: 1000n } },
      sessions: {
        create: { tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60000) },
      },
    },
  });
  await prisma.game.create({
    data: {
      id: gameId,
      slug: `admin-test-${gameId}`,
      name: 'Admin regression game',
      status: 'DRAFT',
    },
  });
});
afterAll(async () => {
  if (!enabled) return;
  if (previousIds === undefined) delete process.env.ADMIN_USER_IDS;
  else process.env.ADMIN_USER_IDS = previousIds;
  await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
  await prisma.game.delete({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { id: { in: [actor.id, playerId] } } });
  await prisma.$disconnect();
});
it.skipIf(!enabled)(
  'makes audited adjustments exactly once and rejects conflicting or excessive debits',
  async () => {
    const admin = new AdminController(prisma);
    const input = { amount: '100', reason: 'Regression fixture', commandId: crypto.randomUUID() };
    await admin.adjustment(playerId, input, actor);
    await admin.adjustment(playerId, input, actor);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: playerId } })).balance).toBe(
      1100n,
    );
    expect(
      await prisma.auditLog.count({ where: { actorId: actor.id, entityType: 'Wallet' } }),
    ).toBe(1);
    await expect(admin.adjustment(playerId, { ...input, amount: '101' }, actor)).rejects.toThrow(
      'Idempotency',
    );
    await expect(
      admin.adjustment(
        playerId,
        { ...input, amount: '-99999', commandId: crypto.randomUUID() },
        actor,
      ),
    ).rejects.toThrow();
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: playerId } })).balance).toBe(
      1100n,
    );
  },
);
it.skipIf(!enabled)(
  'suspends players, revokes sessions, allows reactivation and protects administrators',
  async () => {
    const admin = new AdminController(prisma);
    await admin.playerStatus(
      playerId,
      { status: 'SUSPENDED', reason: 'Regression fixture' },
      actor,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: playerId } })).status).toBe(
      'SUSPENDED',
    );
    expect(await prisma.session.count({ where: { userId: playerId, status: 'ACTIVE' } })).toBe(0);
    await admin.playerStatus(
      playerId,
      { status: 'ACTIVE', reason: 'Regression restoration' },
      actor,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: playerId } })).status).toBe(
      'ACTIVE',
    );
    await expect(
      admin.playerStatus(
        actor.id,
        { status: 'SUSPENDED', reason: 'Reject self suspension' },
        actor,
      ),
    ).rejects.toThrow();
  },
);
it.skipIf(!enabled)('changes game availability with an audit record', async () => {
  const admin = new AdminController(prisma);
  await admin.gameStatus(gameId, { status: 'ACTIVE', reason: 'Regression fixture' }, actor);
  expect((await prisma.game.findUniqueOrThrow({ where: { id: gameId } })).status).toBe('ACTIVE');
  await admin.gameStatus(gameId, { status: 'DRAFT', reason: 'Regression restoration' }, actor);
  expect(await prisma.auditLog.count({ where: { actorId: actor.id, entityType: 'Game' } })).toBe(2);
});
