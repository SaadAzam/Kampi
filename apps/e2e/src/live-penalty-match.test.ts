import { describe, expect, it } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { randomUUID } from 'node:crypto';

const API_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const REALTIME_URL = process.env.REALTIME_PUBLIC_URL ?? 'ws://localhost:2567';

type Snapshot = {
  phase: string;
  matchId: string;
  activeTurn: {
    turnId: string;
    kickerSeat: 'A' | 'B';
    goalkeeperSeat: 'A' | 'B';
  } | null;
  players: Array<{ seat: string; score: number }>;
  winnerSeat: string | null;
  revealedHistory: Array<{ turnId: string; outcome: string }>;
};

async function createGuest() {
  const response = await fetch(`${API_URL}/auth/guest`, { method: 'POST' });
  if (!response.ok) throw new Error(`guest failed: ${response.status}`);
  return (await response.json()) as { token: string; user: { id: string } };
}

function waitForMessage<T>(room: Room, type: string, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${type}`)), timeoutMs);
    room.onMessage(type, (payload) => {
      clearTimeout(timer);
      resolve(payload as T);
    });
  });
}

function attachSnapshot(room: Room): { get(): Snapshot | null } {
  let latest: Snapshot | null = null;
  room.onMessage('snapshot', (payload) => {
    latest = payload as Snapshot;
  });
  room.onMessage('seat_assigned', () => undefined);
  room.onMessage('private_ack', () => undefined);
  room.onMessage('turn_revealed', () => undefined);
  room.onMessage('match_completed', (payload) => {
    latest = {
      ...(latest ?? {
        phase: 'FINISHED',
        matchId: '',
        activeTurn: null,
        players: [],
        winnerSeat: null,
        revealedHistory: [],
      }),
      phase: 'FINISHED',
      ...(payload as object),
    } as Snapshot;
  });
  room.onMessage('queue_joined', () => undefined);
  return {
    get: () => latest,
  };
}

describe('live Penalty full match', () => {
  it('plays a regulation match with two humans and identical scores', async () => {
    if (process.env.KAMPI_LIVE_E2E !== '1') {
      console.warn('Skipping — set KAMPI_LIVE_E2E=1');
      return;
    }

    const a = await createGuest();
    const b = await createGuest();
    const clientA = new Client(REALTIME_URL);
    const clientB = new Client(REALTIME_URL);
    const opts = (token: string) => ({
      authToken: token,
      gameId: 'penalty-duel',
      gameVersion: '1.0.0',
      mode: 'PUBLIC',
      stakeKey: 'default',
      region: 'global',
    });

    const lobbyA = await clientA.joinOrCreate('lobby', opts(a.token));
    attachSnapshot(lobbyA);
    const lobbyB = await clientB.joinOrCreate('lobby', opts(b.token));
    attachSnapshot(lobbyB);

    const [foundA, foundB] = await Promise.all([
      waitForMessage<{ matchId: string; roomId: string; seat: 'A' | 'B'; botFill: boolean }>(
        lobbyA,
        'match_found',
      ),
      waitForMessage<{ matchId: string; roomId: string; seat: 'A' | 'B'; botFill: boolean }>(
        lobbyB,
        'match_found',
      ),
    ]);
    expect(foundA.matchId).toBe(foundB.matchId);
    expect(foundA.botFill).toBe(false);

    const roomA = await clientA.joinById(foundA.roomId, {
      authToken: a.token,
      seat: foundA.seat,
      matchId: foundA.matchId,
      gameId: 'penalty-duel',
    });
    const snapA = attachSnapshot(roomA);
    roomA.send('request_snapshot');

    const roomB = await clientB.joinById(foundB.roomId, {
      authToken: b.token,
      seat: foundB.seat,
      matchId: foundB.matchId,
      gameId: 'penalty-duel',
    });
    const snapB = attachSnapshot(roomB);
    roomB.send('request_snapshot');

    await expect
      .poll(() => {
        roomA.send('request_snapshot');
        roomB.send('request_snapshot');
        return snapA.get()?.phase === 'AWAITING_ACTIONS' && snapB.get()?.phase === 'AWAITING_ACTIONS';
      }, { timeout: 15_000 })
      .toBe(true);

    for (let i = 0; i < 8; i += 1) {
      await expect
        .poll(() => {
          roomA.send('request_snapshot');
          const s = snapA.get();
          return s?.phase === 'AWAITING_ACTIONS' ? s.activeTurn?.turnId : null;
        }, { timeout: 12_000 })
        .toBeTruthy();

      const turn = snapA.get()!.activeTurn!;
      expect(JSON.stringify(snapB.get()?.activeTurn ?? {})).not.toMatch(/"shot"|"dive"/);

      const actionFor = (seat: 'A' | 'B') => {
        if (seat === turn.kickerSeat) return 'SHOOT_LEFT';
        return turn.kickerSeat === 'A' ? 'DIVE_RIGHT' : 'DIVE_LEFT';
      };

      const historyBefore = snapA.get()?.revealedHistory.length ?? 0;
      roomA.send('submit_action', {
        protocolVersion: '1.0.0',
        gameId: 'penalty-duel',
        commandId: randomUUID(),
        turnId: turn.turnId,
        action: actionFor(foundA.seat),
      });
      roomB.send('submit_action', {
        protocolVersion: '1.0.0',
        gameId: 'penalty-duel',
        commandId: randomUUID(),
        turnId: turn.turnId,
        action: actionFor(foundB.seat),
      });

      await expect
        .poll(() => (snapA.get()?.revealedHistory.length ?? 0) > historyBefore, {
          timeout: 12_000,
        })
        .toBe(true);

      if (snapA.get()?.phase === 'FINISHED' || snapB.get()?.phase === 'FINISHED') break;

      // Wait out revealDurationMs before next actions are accepted
      await expect
        .poll(() => {
          roomA.send('request_snapshot');
          const phase = snapA.get()?.phase;
          return phase === 'AWAITING_ACTIONS' || phase === 'FINISHED';
        }, { timeout: 8_000 })
        .toBe(true);

      if (snapA.get()?.phase === 'FINISHED') break;
    }

    await expect
      .poll(() => {
        roomA.send('request_snapshot');
        roomB.send('request_snapshot');
        return snapA.get()?.phase === 'FINISHED' && snapB.get()?.phase === 'FINISHED';
      }, { timeout: 20_000 })
      .toBe(true);

    expect(snapA.get()?.winnerSeat).toBe(snapB.get()?.winnerSeat);
    expect(snapA.get()?.players.map((p) => p.score)).toEqual(
      snapB.get()?.players.map((p) => p.score),
    );
    expect(snapA.get()?.winnerSeat).toBe('A');

    roomA.leave();
    roomB.leave();
  }, 120_000);
});
