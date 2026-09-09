import { describe, expect, it } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { randomUUID } from 'node:crypto';

const API_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const TEST_REGION = `regression-${crypto.randomUUID()}`;
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
  it.each(['regulation', 'sudden-death', 'private', 'reconnect'] as const)(
    'plays %s with two humans and identical scores',
    async (mode) => {
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
        region: TEST_REGION,
      });

      const lobbyA = await clientA.joinOrCreate('lobby', {
        ...opts(a.token),
        ...(mode === 'private' ? { mode: 'PRIVATE', action: 'create_private' } : {}),
      });
      attachSnapshot(lobbyA);
      const foundAPromise = waitForMessage<{
        matchId: string;
        roomId: string;
        seat: 'A' | 'B';
        botFill: boolean;
      }>(lobbyA, 'match_found');
      const invite =
        mode === 'private'
          ? await waitForMessage<{ code: string }>(lobbyA, 'invite_created')
          : null;
      const lobbyB = await clientB.joinOrCreate('lobby', {
        ...opts(b.token),
        ...(invite ? { mode: 'PRIVATE', action: 'join_private', inviteCode: invite.code } : {}),
      });
      attachSnapshot(lobbyB);
      const [foundA, foundB] = await Promise.all([
        foundAPromise,
        waitForMessage<{ matchId: string; roomId: string; seat: 'A' | 'B'; botFill: boolean }>(
          lobbyB,
          'match_found',
        ),
      ]);
      expect(foundA.matchId).toBe(foundB.matchId);
      expect(foundA.botFill).toBe(false);

      let roomA = await clientA.joinById(foundA.roomId, {
        authToken: a.token,
        seat: foundA.seat,
        matchId: foundA.matchId,
        gameId: 'penalty-duel',
      });
      let snapA = attachSnapshot(roomA);
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
        .poll(
          () => {
            roomA.send('request_snapshot');
            roomB.send('request_snapshot');
            return (
              snapA.get()?.phase === 'AWAITING_ACTIONS' && snapB.get()?.phase === 'AWAITING_ACTIONS'
            );
          },
          { timeout: 15_000 },
        )
        .toBe(true);

      for (
        let reconnectAttempt = 0;
        mode === 'reconnect' && reconnectAttempt < 3;
        reconnectAttempt++
      ) {
        const reconnectionToken = roomA.reconnectionToken;
        await new Promise<void>((resolve) => {
          roomA.onLeave(() => resolve());
          roomA.connection.close();
        });
        roomA = await new Client(REALTIME_URL).reconnect(reconnectionToken);
        snapA = attachSnapshot(roomA);
        roomA.send('request_snapshot');
        await expect.poll(() => snapA.get()?.phase, { timeout: 5000 }).toBe('AWAITING_ACTIONS');
      }
      for (let i = 0; i < 12; i += 1) {
        await expect
          .poll(
            () => {
              roomA.send('request_snapshot');
              const s = snapA.get();
              return s?.phase === 'AWAITING_ACTIONS' ? s.activeTurn?.turnId : null;
            },
            { timeout: 12_000 },
          )
          .toBeTruthy();

        const turn = snapA.get()!.activeTurn!;
        expect(JSON.stringify(snapB.get()?.activeTurn ?? {})).not.toMatch(/"shot"|"dive"/);

        const actionFor = (seat: 'A' | 'B') => {
          if (seat === turn.kickerSeat) return 'SHOOT_LEFT';
          if (mode === 'sudden-death' && i < 6) return 'DIVE_RIGHT';
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
          .poll(
            () => {
              roomA.send('request_snapshot');
              const phase = snapA.get()?.phase;
              return phase === 'AWAITING_ACTIONS' || phase === 'FINISHED';
            },
            { timeout: 8_000 },
          )
          .toBe(true);

        if (snapA.get()?.phase === 'FINISHED') break;
      }

      await expect
        .poll(
          () => {
            roomA.send('request_snapshot');
            roomB.send('request_snapshot');
            return snapA.get()?.phase === 'FINISHED' && snapB.get()?.phase === 'FINISHED';
          },
          { timeout: 20_000 },
        )
        .toBe(true);

      expect(snapA.get()?.winnerSeat).toBe(snapB.get()?.winnerSeat);
      expect(snapA.get()?.players.map((p) => p.score)).toEqual(
        snapB.get()?.players.map((p) => p.score),
      );
      expect(snapA.get()?.winnerSeat).toBe('A');

      if (mode === 'sudden-death') expect(snapA.get()?.revealedHistory.length).toBe(8);
      const [balanceA, balanceB] = await Promise.all(
        [a, b].map(async (guest) => {
          const response = await fetch(`${API_URL}/wallet/balance`, {
            headers: { Authorization: `Bearer ${guest.token}` },
          });
          return ((await response.json()) as { balance: string }).balance;
        }),
      );
      expect(balanceA).toBe(foundA.seat === 'A' ? '10450' : '9500');
      expect(balanceB).toBe(foundB.seat === 'A' ? '10450' : '9500');
      for (const guest of [a, b]) {
        const headers = { Authorization: `Bearer ${guest.token}` };
        const history = (await fetch(`${API_URL}/matches/history`, { headers }).then((r) =>
          r.json(),
        )) as {
          matches: Array<{
            matchId: string;
            result: string;
            score: number;
            opponentScore: number;
            gameName: string;
          }>;
        };
        const match = history.matches.find((m) => m.matchId === foundA.matchId);
        expect(match?.result).toMatch(/WIN|LOSS/);
        expect(match?.gameName).toBe('Penalty Duel');
        expect(match?.score).toBeTypeOf('number');
        expect(match?.opponentScore).toBeTypeOf('number');
        const stats = (await fetch(`${API_URL}/stats/me`, { headers }).then((r) => r.json())) as {
          wins: number;
          losses: number;
          xp: number;
        };
        expect(stats.wins + stats.losses).toBe(1);
        expect(stats.xp).toBe(match?.result === 'WIN' ? 50 : 15);
      }
      await roomA.leave();
      await roomB.leave();
      await lobbyA.leave();
      await lobbyB.leave();
    },
    120_000,
  );
});
