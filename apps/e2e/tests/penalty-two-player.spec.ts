import { expect, test, type Browser, type Page } from '@playwright/test';

const API_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const GAME_URL = process.env.GAME_PENALTY_PUBLIC_URL ?? 'http://localhost:5174';

async function createGuest(): Promise<{ token: string; userId: string; displayName: string }> {
  const response = await fetch(`${API_URL}/auth/guest`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Guest auth failed: ${response.status}`);
  }
  const body = (await response.json()) as {
    token: string;
    user: { id: string; displayName: string };
  };
  return { token: body.token, userId: body.user.id, displayName: body.user.displayName };
}

async function openPlayer(browser: Browser, token: string, userId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(
    ({ authToken, id }: { authToken: string; id: string }) => {
      sessionStorage.setItem('kampi.authToken', authToken);
      (window as unknown as { __kampiUserId?: string }).__kampiUserId = id;
    },
    { authToken: token, id: userId },
  );
  await page.goto(GAME_URL);
  await page.waitForSelector('[data-testid="find-match"]');
  await page.evaluate((id) => {
    const el = document.querySelector('[data-testid="player-id"]');
    if (el) el.textContent = id;
  }, userId);
  return page;
}

async function waitForMatch(page: Page): Promise<string> {
  await expect(page.locator('[data-testid="match-id"]')).not.toHaveText('', { timeout: 25_000 });
  const matchId = (await page.locator('[data-testid="match-id"]').textContent())?.trim() ?? '';
  expect(matchId.length).toBeGreaterThan(10);
  return matchId;
}

async function playTurn(page: Page) {
  const seat = ((await page.getByTestId('seat').textContent()) ?? '').trim();
  const role = ((await page.getByTestId('role').textContent()) ?? '').trim();
  if (role.includes('KICKER')) {
    await page.getByTestId('action-left').click();
    return;
  }
  if (role.includes('GOALKEEPER')) {
    // Seat A saves opponent kicks; seat B fails to save → A wins regulation 3-0
    if (seat === 'A') await page.getByTestId('action-left').click();
    else await page.getByTestId('action-right').click();
  }
}

test.describe('Penalty Duel two-player', () => {
  test('two distinct guests finish a public match', async ({ browser }) => {
    try {
      const health = await fetch(`${API_URL}/health/live`);
      if (!health.ok) test.skip(true, 'API not running');
      const game = await fetch(GAME_URL);
      if (!game.ok) test.skip(true, 'Penalty client not running on 5174');
    } catch {
      test.skip(true, 'API or Penalty client not reachable');
    }

    const guestA = await createGuest();
    const guestB = await createGuest();
    expect(guestA.userId).not.toBe(guestB.userId);

    const pageA = await openPlayer(browser, guestA.token, guestA.userId);
    const pageB = await openPlayer(browser, guestB.token, guestB.userId);

    await pageA.getByTestId('find-match').click();
    await pageB.getByTestId('find-match').click();

    const matchA = await waitForMatch(pageA);
    const matchB = await waitForMatch(pageB);
    expect(matchA).toBe(matchB);

    const seatA = (await pageA.getByTestId('seat').textContent())?.trim();
    const seatB = (await pageB.getByTestId('seat').textContent())?.trim();
    expect(seatA).not.toBe(seatB);
    expect(['A', 'B']).toContain(seatA);
    expect(['A', 'B']).toContain(seatB);

    for (let i = 0; i < 10; i += 1) {
      const statusA = ((await pageA.getByTestId('status').textContent()) ?? '').trim();
      if (statusA === 'FINISHED') break;

      await expect
        .poll(async () => ((await pageA.getByTestId('role').textContent()) ?? '').trim(), {
          timeout: 12_000,
        })
        .toMatch(/KICKER|GOALKEEPER/);

      await playTurn(pageA);
      await playTurn(pageB);

      await pageA.waitForTimeout(2500);
    }

    await expect
      .poll(async () => (await pageA.getByTestId('status').textContent()) ?? '', {
        timeout: 60_000,
      })
      .toMatch(/FINISHED/);

    const scoreA = (await pageA.getByTestId('score').textContent())?.trim();
    const scoreB = (await pageB.getByTestId('score').textContent())?.trim();
    expect(scoreA).toBe(scoreB);

    const resultA = (await pageA.getByTestId('result').textContent()) ?? '';
    const resultB = (await pageB.getByTestId('result').textContent()) ?? '';
    const wins = [resultA, resultB].filter((r) => r.includes('YOU WIN')).length;
    expect(wins).toBe(1);
  });
});
