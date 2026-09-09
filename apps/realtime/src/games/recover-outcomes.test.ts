import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), record: vi.fn() }));
vi.mock('@kampi/database', () => ({ prisma: { match: { findMany: mocks.findMany } } }));
vi.mock('@kampi/domain', () => ({ recordMatchOutcome: mocks.record }));
import { recoverPenaltyOutcomes } from './recover-outcomes.js';
beforeEach(() => vi.clearAllMocks());
it('repairs finished stats from durable server events without inventing scores', async () => {
  mocks.findMany.mockResolvedValue([
    {
      id: 'm',
      winnerPlayerId: 'winner',
      events: [{ payload: { winnerSeat: 'B', scores: { A: 1, B: 3 } } }],
    },
    { id: 'invalid', events: [{ payload: { winnerSeat: 'A' } }] },
  ]);
  await recoverPenaltyOutcomes();
  expect(mocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ status: 'FINISHED' }) }),
  );
  expect(mocks.record).toHaveBeenCalledTimes(1);
  expect(mocks.record).toHaveBeenCalledWith(expect.anything(), {
    matchId: 'm',
    winnerSlot: 2,
    winnerUserId: 'winner',
    scores: [
      { slot: 1, score: 1 },
      { slot: 2, score: 3 },
    ],
  });
});
