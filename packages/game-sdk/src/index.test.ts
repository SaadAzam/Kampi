import { describe, expect, it, vi } from 'vitest';
import { GameRegistry, CommandGuard, SettlementCoordinator } from './server/index.js';
import { GameManifestSchema, createRandomProvider, queueKeyString } from './common/index.js';
import { FakeClock, FakeClient } from './testing/index.js';
import { GameSessionClient } from './client/index.js';
import { isAllowedOrigin } from '@kampi/contracts';

describe('GameManifestSchema', () => {
  it('validates a manifest', () => {
    const manifest = GameManifestSchema.parse({
      gameId: 'penalty-duel',
      displayName: 'Penalty Duel',
      protocolVersion: '1.0.0',
      roomName: 'penalty-duel',
    });
    expect(manifest.maxPlayers).toBe(2);
  });
});

describe('GameRegistry', () => {
  it('rejects duplicates and unknown games', () => {
    const registry = new GameRegistry();
    registry.register({
      gameId: 'rock-paper-scissors',
      displayName: 'RPS',
      protocolVersion: '1.0.0',
      roomName: 'rps',
    });
    expect(() =>
      registry.register({
        gameId: 'rock-paper-scissors',
        displayName: 'RPS',
        protocolVersion: '1.0.0',
        roomName: 'rps',
      }),
    ).toThrow(/Duplicate/);
    expect(() => registry.get('missing')).toThrow(/Unknown/);
  });

  it('rejects unsupported protocol', () => {
    const registry = new GameRegistry();
    registry.register({
      gameId: 'penalty-duel',
      displayName: 'Penalty Duel',
      protocolVersion: '1.0.0',
      roomName: 'penalty-duel',
    });
    expect(() => registry.assertProtocol('penalty-duel', '9.9.9')).toThrow(/protocol/);
  });
});

describe('queue isolation keys', () => {
  it('separates games and stakes', () => {
    const a = queueKeyString({
      gameId: 'penalty-duel',
      gameVersion: '1.0.0',
      mode: 'PUBLIC',
      stakeKey: 'default',
      region: 'global',
    });
    const b = queueKeyString({
      gameId: 'rock-paper-scissors',
      gameVersion: '1.0.0',
      mode: 'PUBLIC',
      stakeKey: 'default',
      region: 'global',
    });
    const c = queueKeyString({
      gameId: 'penalty-duel',
      gameVersion: '1.0.0',
      mode: 'PUBLIC',
      stakeKey: 'high',
      region: 'global',
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('CommandGuard', () => {
  it('detects duplicate command ids', () => {
    const guard = new CommandGuard();
    expect(guard.checkIdempotency('c1')).toBe('new');
    expect(guard.checkIdempotency('c1')).toBe('duplicate');
  });
});

describe('SettlementCoordinator', () => {
  it('pays only once', async () => {
    let payouts = 0;
    const coordinator = new SettlementCoordinator({
      async deductEntryFees() {},
      async finalizeMatchPayout() {
        payouts += 1;
        return { paid: true };
      },
      async refundAbortedMatch() {},
    });
    await coordinator.payWinner({
      matchId: 'm',
      winnerUserId: 'u',
      payout: 950n,
      payoutLedgerKey: 'p',
    });
    await coordinator.payWinner({
      matchId: 'm',
      winnerUserId: 'u',
      payout: 950n,
      payoutLedgerKey: 'p',
    });
    expect(payouts).toBe(1);
  });
});

describe('host origin checks', () => {
  it('keeps allowlist semantics', () => {
    expect(isAllowedOrigin('http://localhost:3000', ['http://localhost:3000'])).toBe(true);
    expect(isAllowedOrigin('http://evil.com', ['http://localhost:3000'])).toBe(false);
  });
});

describe('resolveParentOrigin', () => {
  it('uses the iframe parent origin instead of localhost', async () => {
    const { resolveParentOrigin, embedAllowedOrigins } = await import('./embed/bridge.js');
    const parent = 'https://web-production-fc16.up.railway.app';
    expect(
      resolveParentOrigin('http://localhost:3000', {
        ancestorOrigins: { length: 1, item: () => parent },
        referrer: '',
      }),
    ).toBe(parent);
    expect(
      resolveParentOrigin('http://localhost:3000', {
        ancestorOrigins: { length: 0, item: () => null },
        referrer: `${parent}/play`,
      }),
    ).toBe(parent);
    expect(
      resolveParentOrigin('http://localhost:3000', {
        ancestorOrigins: { length: 0, item: () => null },
        referrer: '',
      }),
    ).toBe('http://localhost:3000');
    expect(embedAllowedOrigins(parent, 'http://localhost:3000')).toEqual([
      parent,
      'http://localhost:3000',
    ]);
  });
});

describe('GameSessionClient', () => {
  it('connects with injected fake client and cleans up', async () => {
    const fake = new FakeClient();
    const session = new GameSessionClient({
      realtimeUrl: 'ws://localhost:2567',
      authToken: 'token',
      gameId: 'penalty-duel',
      clientFactory: () => fake,
    });
    await session.connect();
    expect(session.getConnectionStatus()).toBe('connected');
    session.destroy();
    expect(session.getConnectionStatus()).toBe('disconnected');
  });
});

describe('FakeClock and RNG', () => {
  it('advances and picks deterministically', () => {
    const clock = new FakeClock(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    const rng = createRandomProvider(() => 0);
    expect(rng.pick(['L', 'R'])).toBe('L');
  });
});

describe('completed match connections', () => {
  it('does not reconnect after the server closes a completed match', async () => {
    const fake = new FakeClient();
    const reconnect = vi.spyOn(fake, 'reconnect');
    const session = new GameSessionClient({
      realtimeUrl: 'ws://localhost',
      authToken: 'test',
      gameId: 'penalty-duel',
      clientFactory: () => fake,
    });
    await session.joinQueue();
    fake.rooms[0]!.emit('match_found', {
      matchId: 'm',
      roomId: 'r',
      seat: 'A',
      gameId: 'penalty-duel',
    });
    await vi.waitFor(() => expect(session.getConnectionStatus()).toBe('in_match'));
    fake.rooms[1]!.emit('match_completed', { winnerSeat: 'A' });
    fake.rooms[1]!.disconnect(4000);
    expect(reconnect).not.toHaveBeenCalled();
    expect(session.getConnectionStatus()).toBe('disconnected');
    session.destroy();
  });
});

describe('connection recovery races', () => {
  const make = (fake: FakeClient) =>
    new GameSessionClient({
      realtimeUrl: 'ws://localhost',
      authToken: 'test',
      gameId: 'penalty-duel',
      clientFactory: () => fake,
    });
  it('discards a lobby that arrives after cancellation', async () => {
    const fake = new FakeClient();
    const room = await fake.joinOrCreate('lobby');
    let resolve!: (value: typeof room) => void;
    vi.spyOn(fake, 'joinOrCreate').mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const leave = vi.spyOn(room, 'leave');
    const session = make(fake);
    await session.connect();
    const pending = session.joinQueue();
    session.leaveQueue();
    resolve(room);
    await pending;
    expect(leave).toHaveBeenCalledWith(true);
    expect(session.getConnectionStatus()).toBe('connected');
    session.destroy();
  });
  it('coalesces reconnect requests and requests an authoritative snapshot', async () => {
    const fake = new FakeClient();
    const room = await fake.reconnect('token');
    let resolve!: (value: typeof room) => void;
    const reconnect = vi.spyOn(fake, 'reconnect').mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const send = vi.spyOn(room, 'send');
    const session = make(fake);
    await session.connect();
    const resume = session.resume('token');
    const duplicate = session.reconnect();
    expect(reconnect).toHaveBeenCalledTimes(1);
    resolve(room);
    await Promise.all([resume, duplicate]);
    expect(send).toHaveBeenCalledWith('request_snapshot');
    expect(session.getConnectionStatus()).toBe('in_match');
    session.destroy();
  });
  it('does not resurrect a match after leaving during a reconnect', async () => {
    const fake = new FakeClient();
    const room = await fake.reconnect('token');
    let resolve!: (value: typeof room) => void;
    vi.spyOn(fake, 'reconnect').mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const leave = vi.spyOn(room, 'leave');
    const session = make(fake);
    await session.connect();
    const pending = session.resume('token');
    session.leaveMatch();
    resolve(room);
    await pending;
    expect(leave).toHaveBeenCalledWith(true);
    expect(session.getConnectionStatus()).toBe('connected');
    session.destroy();
  });
  it('surfaces a lost matchmaking socket instead of leaving a permanent spinner', async () => {
    const fake = new FakeClient();
    const session = make(fake);
    const error = vi.fn();
    session.on('error', error);
    await session.joinQueue();
    fake.rooms[0]!.disconnect(1006);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONNECTION_LOST' }));
    session.destroy();
  });
});
