import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ game: vi.fn(), activeUsers: vi.fn() }));
vi.mock('../config.js', () => ({
  env: { JWT_SECRET: 'test-key-with-at-least-32-characters' },
  economy: {},
}));
vi.mock('@kampi/database', () => ({
  prisma: { game: { findUniqueOrThrow: mocks.game }, user: { count: mocks.activeUsers } },
}));
import { LobbyRoom } from './lobby-room.js';
type Entry = { userId: string; queueKey: { gameId: string } };
type Harness = { doCreateAndNotifyMatch(a: Entry, b: Entry, botFill: boolean): Promise<void> };
const a = { userId: 'alice', queueKey: { gameId: 'penalty-duel' } };
const b = { userId: 'bob', queueKey: { gameId: 'penalty-duel' } };
beforeEach(() => vi.resetAllMocks());
it('rejects an already-queued or private match after its game is paused', async () => {
  mocks.game.mockResolvedValue({ id: 'game', status: 'DRAFT' });
  const room = new LobbyRoom() as unknown as Harness;
  await expect(room.doCreateAndNotifyMatch(a, b, false)).rejects.toThrow('currently unavailable');
  expect(mocks.activeUsers).not.toHaveBeenCalled();
});
it.each([false, true])(
  'rechecks suspended players immediately before human/bot creation (%s)',
  async (bot) => {
    mocks.game.mockResolvedValue({ id: 'game', status: 'ACTIVE' });
    mocks.activeUsers.mockResolvedValue(0);
    const room = new LobbyRoom() as unknown as Harness;
    await expect(room.doCreateAndNotifyMatch(a, b, bot)).rejects.toThrow('no longer eligible');
    expect(mocks.activeUsers).toHaveBeenCalledWith({
      where: { id: { in: bot ? ['alice'] : ['alice', 'bob'] }, status: 'ACTIVE' },
    });
  },
);
