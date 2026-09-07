import { describe, expect, it } from 'vitest';
import { Client } from 'colyseus.js';

const API_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const TEST_REGION = `regression-${crypto.randomUUID()}`;
const REALTIME_URL = process.env.REALTIME_PUBLIC_URL ?? 'ws://localhost:2567';

async function createGuest() {
  const response = await fetch(`${API_URL}/auth/guest`, { method: 'POST' });
  if (!response.ok) throw new Error(`guest failed: ${response.status}`);
  return (await response.json()) as { token: string; user: { id: string } };
}

async function stackUp(): Promise<boolean> {
  try {
    const [api, rt] = await Promise.all([
      fetch(`${API_URL}/health/live`),
      fetch(`${REALTIME_URL.replace(/^ws/, 'http')}/health/ready`),
    ]);
    if (!api.ok || !rt.ok) return false;
    const guest = await fetch(`${API_URL}/auth/guest`, { method: 'POST' });
    return guest.ok;
  } catch {
    return false;
  }
}

describe('live two-client Penalty matchmaking', () => {
  it('matches two distinct humans without a bot when both queue quickly', async () => {
    if (process.env.KAMPI_LIVE_E2E !== '1') {
      console.warn('Skipping live integration — set KAMPI_LIVE_E2E=1 with stack running');
      return;
    }
    if (!(await stackUp())) {
      throw new Error('KAMPI_LIVE_E2E=1 but API/realtime/guest auth are not ready');
    }

    const a = await createGuest();
    const b = await createGuest();
    expect(a.user.id).not.toBe(b.user.id);

    const clientA = new Client(REALTIME_URL);
    const clientB = new Client(REALTIME_URL);

    const lobbyOpts = (token: string) => ({
      authToken: token,
      gameId: 'penalty-duel',
      gameVersion: '1.0.0',
      mode: 'PUBLIC',
      stakeKey: 'default',
      region: TEST_REGION,
    });

    const found = await Promise.all([
      new Promise<{ matchId: string; seat: string; botFill: boolean }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout waiting for match A')), 20_000);
        void clientA.joinOrCreate('lobby', lobbyOpts(a.token)).then((room) => {
          room.onMessage('match_found', (payload) => {
            clearTimeout(timer);
            resolve(payload as never);
          });
          room.onMessage('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
      }),
      new Promise<{ matchId: string; seat: string; botFill: boolean }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout waiting for match B')), 20_000);
        void clientB.joinOrCreate('lobby', lobbyOpts(b.token)).then((room) => {
          room.onMessage('match_found', (payload) => {
            clearTimeout(timer);
            resolve(payload as never);
          });
          room.onMessage('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
      }),
    ]);

    expect(found[0].matchId).toBe(found[1].matchId);
    expect(found[0].seat).not.toBe(found[1].seat);
    expect(found[0].botFill).toBe(false);
    expect(found[1].botFill).toBe(false);
  }, 30_000);
});
