import { expect, it } from 'vitest';
import { Client, type Room } from 'colyseus.js';
const api = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const realtime = process.env.REALTIME_PUBLIC_URL ?? 'ws://localhost:2567';
it.each(['one', 'both'] as const)(
  'settles correctly when %s players exhaust reconnect grace',
  async (disconnected) => {
    if (process.env.KAMPI_LIVE_E2E !== '1') return;
    const guests = await Promise.all(
      [0, 1].map(async () => {
        const response = await fetch(`${api}/auth/guest`, { method: 'POST' });
        expect(response.ok).toBe(true);
        return (await response.json()) as { token: string };
      }),
    );
    const rooms: Room[] = [];
    const region = `disconnect-${crypto.randomUUID()}`;
    const found = (room: Room) =>
      new Promise<{ roomId: string; matchId: string; seat: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Matchmaking timed out')), 15000);
        room.onMessage('queue_joined', () => undefined);
        room.onMessage('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        room.onMessage('match_found', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    try {
      const a = new Client(realtime),
        b = new Client(realtime);
      const lobbyA = await a.joinOrCreate('lobby', {
        authToken: guests[0]!.token,
        gameId: 'penalty-duel',
        region,
      });
      rooms.push(lobbyA);
      const firstFound = found(lobbyA);
      const lobbyB = await b.joinOrCreate('lobby', {
        authToken: guests[1]!.token,
        gameId: 'penalty-duel',
        region,
      });
      rooms.push(lobbyB);
      const [first, second] = await Promise.all([firstFound, found(lobbyB)]);
      const matchA = await a.joinById(first.roomId, {
        authToken: guests[0]!.token,
        seat: first.seat,
      });
      matchA.onMessage('*', () => undefined);
      rooms.push(matchA);
      const matchB = await b.joinById(second.roomId, {
        authToken: guests[1]!.token,
        seat: second.seat,
      });
      matchB.onMessage('*', () => undefined);
      rooms.push(matchB);
      const history = async (token: string) => {
        const body = (await fetch(`${api}/matches/history`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json())) as {
          matches: Array<{ matchId: string; status: string; result: string }>;
        };
        return body.matches.find((match) => match.matchId === first.matchId);
      };
      await expect.poll(async () => (await history(guests[0]!.token))?.status).toBe('ACTIVE');
      matchA.connection.close();
      if (disconnected === 'both') matchB.connection.close();
      await expect
        .poll(async () => (await history(guests[0]!.token))?.status, {
          timeout: 45000,
          interval: 1000,
        })
        .toBe(disconnected === 'both' ? 'ABORTED' : 'FINISHED');
      for (const [index, guest] of guests.entries()) {
        const balance = (await fetch(`${api}/wallet/balance`, {
          headers: { Authorization: `Bearer ${guest.token}` },
        }).then((r) => r.json())) as { balance: string };
        expect(balance.balance).toBe(
          disconnected === 'both' ? '10000' : index === 0 ? '9500' : '10450',
        );
        if (disconnected === 'one')
          expect((await history(guest.token))?.result).toBe(index === 0 ? 'LOSS' : 'WIN');
      }
    } finally {
      for (const room of rooms) void room.leave();
    }
  },
  90000,
);
