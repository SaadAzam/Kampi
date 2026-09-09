import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@colyseus/core';
import { createRandomProvider } from '@kampi/game-sdk/common';

const mocks = vi.hoisted(() => ({
  debit: vi.fn(async () => undefined),
  payout: vi.fn(async () => ({ paid: true })),
  refund: vi.fn(async () => undefined),
  event: vi.fn(async () => ({})),
  stats: vi.fn(async () => undefined),
  update: vi.fn(async () => ({})),
  activate: vi.fn(async () => ({ count: 1 })),
}));
vi.mock('../config.js', () => ({
  env: { JWT_SECRET: 'test-secret-with-at-least-32-characters' },
  economy: { reconnectGraceMs: 30000 },
}));
vi.mock('@kampi/database', () => ({
  prisma: {
    match: { update: mocks.update, updateMany: mocks.activate },
    matchEvent: { create: mocks.event },
  },
}));
vi.mock('@kampi/domain', () => ({
  deductEntryFees: mocks.debit,
  finalizeMatchPayout: mocks.payout,
  refundAbortedMatch: mocks.refund,
}));
vi.mock('../auth.js', () => ({
  authenticateToken: async (token: string) =>
    token === 'bad' ? null : { userId: token, displayName: token },
}));
vi.mock('../games/persist-outcome.js', () => ({ persistMatchOutcome: mocks.stats }));
import { PenaltyDuelRoom } from './penalty-room.js';
import { authorizeRoom, assertRoomAuthorized } from '../games/room-authorization.js';

const matchId = '11111111-1111-4111-8111-111111111111';
function options() {
  return authorizeRoom({
    matchId,
    botFill: false,
    gameId: 'penalty-duel',
    playerA: { userId: 'alice', displayName: 'Alice', seat: 'A' as const, kind: 'HUMAN' as const },
    playerB: { userId: 'bob', displayName: 'Bob', seat: 'B' as const, kind: 'HUMAN' as const },
    economy: { entryFee: '500', winnerPayout: '950' },
    versionConfig: { decisionTimeMs: 1000, revealDurationMs: 100, reconnectGraceMs: 2000 },
  });
}
function client(id: string) {
  return { sessionId: id, send: vi.fn() } as unknown as Client;
}
type Harness = {
  phase: string;
  activeTurnId: string;
  activeDeadlineAt: number;
  handleSubmitAction(client: Client, raw: unknown): Promise<void>;
  buildSnapshot(seat?: 'A' | 'B'): {
    activeTurn: object;
    revealedHistory: Array<{ outcome: string }>;
    phase: string;
  };
};
let room: PenaltyDuelRoom;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  room = new PenaltyDuelRoom();
  room.setRandomProvider(createRandomProvider(() => 0));
});
afterEach(() => {
  room.onDispose();
  vi.useRealTimers();
});
async function joined() {
  room.onCreate(options());
  const a = client('a'),
    b = client('b');
  await room.onJoin(a, { authToken: 'alice', seat: 'A' });
  await room.onJoin(b, { authToken: 'bob', seat: 'B' });
  return { a, b, internal: room as unknown as Harness };
}
function command(turnId: string, action = 'SHOOT_LEFT') {
  return {
    type: 'submit_action',
    protocolVersion: '1.0.0',
    gameId: 'penalty-duel',
    matchId,
    commandId: crypto.randomUUID(),
    turnId,
    action,
  };
}

describe('actual penalty room security and lifecycle', () => {
  it('rejects forged room creation and changed economy', () => {
    const signed = options();
    expect(() =>
      assertRoomAuthorized({ ...signed, economy: { entryFee: '0', winnerPayout: '999999' } }),
    ).toThrow();
    expect(() => room.onCreate({ ...signed, creationProof: undefined })).toThrow();
  });
  it('waits for both authenticated humans before charging and starting', async () => {
    room.onCreate(options());
    await room.onJoin(client('a'), { authToken: 'alice', seat: 'A' });
    expect(mocks.debit).not.toHaveBeenCalled();
    expect((room as unknown as Harness).phase).toBe('WAITING_FOR_PLAYERS');
    await room.onJoin(client('b'), { authToken: 'bob', seat: 'B' });
    expect(mocks.debit).toHaveBeenCalledTimes(1);
    expect((room as unknown as Harness).phase).toBe('AWAITING_ACTIONS');
  });
  it('rejects invalid, stolen, and duplicate seats', async () => {
    room.onCreate(options());
    await expect(room.onJoin(client('x'), { authToken: 'bad', seat: 'A' })).rejects.toThrow();
    await expect(room.onJoin(client('x'), { authToken: 'bob', seat: 'A' })).rejects.toThrow();
    await room.onJoin(client('a'), { authToken: 'alice', seat: 'A' });
    await expect(room.onJoin(client('x'), { authToken: 'alice', seat: 'A' })).rejects.toThrow();
  });
  it('rejects actions after the deadline even before the timer callback runs', async () => {
    const { a, internal } = await joined();
    const move = command(internal.activeTurnId);
    vi.setSystemTime(internal.activeDeadlineAt + 1);
    await internal.handleSubmitAction(a, move);
    expect(internal.buildSnapshot().revealedHistory[0]?.outcome).toBe('MISS');
    expect(a.send).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'TURN_EXPIRED' }));
  });
  it('keeps directions hidden, rejects wrong protocol and prevents changing a locked choice', async () => {
    const { a, b, internal } = await joined();
    await internal.handleSubmitAction(a, {
      ...command(internal.activeTurnId),
      protocolVersion: '9.0.0',
    });
    expect(a.send).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ code: 'INVALID_COMMAND' }),
    );
    await internal.handleSubmitAction(a, command(internal.activeTurnId));
    expect(internal.buildSnapshot().activeTurn).not.toHaveProperty('shot');
    await internal.handleSubmitAction(a, command(internal.activeTurnId, 'SHOOT_RIGHT'));
    await internal.handleSubmitAction(b, command(internal.activeTurnId, 'DIVE_LEFT'));
    expect(internal.buildSnapshot().revealedHistory[0]?.outcome).toBe('SAVE');
  });
  it('aborts an unjoined room without starting a match', async () => {
    room.onCreate(options());
    await vi.advanceTimersByTimeAsync(2001);
    expect(mocks.debit).not.toHaveBeenCalled();
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });
  it('settles a forfeit only once when both sockets leave together', async () => {
    const { a, b } = await joined();
    await Promise.all([room.onLeave(a, true), room.onLeave(b, true)]);
    expect(mocks.payout).toHaveBeenCalledTimes(1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('retries a failed payout without publishing an unpaid result', async () => {
    const { a, internal } = await joined();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.payout.mockRejectedValueOnce(new Error('Temporary database outage'));
    await room.onLeave(a, true);
    expect(internal.buildSnapshot().phase).toBe('NEXT_TURN');
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.payout).toHaveBeenCalledTimes(2);
    expect(internal.buildSnapshot().phase).toBe('FINISHED');
    log.mockRestore();
  });
  it('does not forfeit a restored socket when the audit database write fails', async () => {
    const { a, internal } = await joined();
    vi.spyOn(room, 'allowReconnection').mockResolvedValue(a);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.event.mockRejectedValueOnce(new Error('audit unavailable'));
    await room.onLeave(a, false);
    expect(internal.buildSnapshot().phase).toBe('AWAITING_ACTIONS');
    expect(mocks.payout).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('retries stats before publishing the completed match without paying twice', async () => {
    const { a, internal } = await joined();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.stats.mockRejectedValueOnce(new Error('stats unavailable'));
    await room.onLeave(a, true);
    expect(internal.buildSnapshot().phase).toBe('NEXT_TURN');
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.stats).toHaveBeenCalledTimes(2);
    expect(mocks.payout).toHaveBeenCalledTimes(1);
    expect(internal.buildSnapshot().phase).toBe('FINISHED');
    log.mockRestore();
  });
  it('refunds both seats on planned shutdown rather than awarding a forfeit', async () => {
    const { internal } = await joined();
    room.onBeforeShutdown();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.payout).not.toHaveBeenCalled();
    expect(internal.buildSnapshot().phase).toBe('ABORTED');
  });
  it('does not restart a match that was cancelled while entry deduction was pending', async () => {
    room.onCreate(options());
    const a = client('a'),
      b = client('b');
    await room.onJoin(a, { authToken: 'alice', seat: 'A' });
    let release!: () => void;
    mocks.debit.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          release = () => resolve(undefined);
        }),
    );
    const joining = room.onJoin(b, { authToken: 'bob', seat: 'B' });
    await vi.waitFor(() => expect(mocks.debit).toHaveBeenCalled());
    room.onBeforeShutdown();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await joining;
    expect(mocks.activate).not.toHaveBeenCalled();
    expect((room as unknown as Harness).phase).toBe('ABORTED');
  });
});
