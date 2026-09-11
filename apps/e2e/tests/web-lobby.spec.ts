import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WEB_URL = process.env.WEB_TEST_URL ?? 'http://127.0.0.1:3200';
const API_ORIGIN = 'http://localhost:4000';
const AUTH_TOKEN = 'web-lobby-test-session';
const NEW_AUTH_TOKEN = 'web-lobby-manual-login-session';
const LOGIN_PASSWORD = 'FixturePassword!2026';
const PLAYER_ID = '72c5a90e-a3b9-4fe0-9878-c573392ee15d';
const pageIssues = new WeakMap<Page, string[]>();

const catalog = [
  {
    id: '00a80a8d-8982-4c8e-b824-3d7ef9bb85eb',
    slug: 'penalty-duel',
    name: 'Penalty Duel',
    description: 'Take your shot. Make the save.',
    clientUrl: 'http://localhost:5174',
    entryFee: '500',
    winnerPayout: '950',
  },
  {
    id: '1b709861-3ca4-4f97-ad77-e7702cf62793',
    slug: 'rock-paper-scissors',
    name: 'Rock Paper Scissors',
    description: 'Three choices. One winner.',
    clientUrl: 'http://localhost:5173',
    entryFee: '100',
    winnerPayout: '190',
  },
];

function playerFixture() {
  return {
    id: PLAYER_ID,
    displayName: 'Demo Challenger',
    email: 'challenger@example.test',
    isGuest: false,
    balance: '2586',
    stats: {
      xp: 625,
      level: 7,
      wins: 12,
      losses: 4,
      draws: 1,
      games: [
        {
          gameSlug: 'penalty-duel',
          gameName: 'Penalty Duel',
          xp: 340,
          level: 3,
          wins: 7,
          losses: 2,
          draws: 0,
        },
      ],
    },
  };
}

const history = {
  matches: [
    {
      matchId: 'bc4ae53c-fecb-49b4-82fc-29d3b2100165',
      gameName: 'Penalty Duel',
      opponent: 'Previous Rival',
      score: 3,
      opponentScore: 1,
      status: 'FINISHED',
      result: 'WIN',
      createdAt: '2026-09-10T09:30:00.000Z',
      botFill: false,
    },
  ],
};

function gameFrame(slug: string) {
  return `<!doctype html><html lang="en"><head><title>Mock game</title></head>
    <body><p data-testid="session-player">Waiting for session</p>
    <script>
      const parentOrigin = new URL(document.referrer).origin;
      window.addEventListener('message', (event) => {
        if (event.source !== parent || event.origin !== parentOrigin) return;
        if (event.data.type === 'session') {
          window.receivedSession = event.data;
          document.querySelector('[data-testid="session-player"]').textContent = event.data.playerId;
        }
      });
      parent.postMessage({type:'game_ready', protocolVersion:'1.0.0', gameSlug:${JSON.stringify(slug)}}, parentOrigin);
    </script></body></html>`;
}

async function mockBackend(context: BrowserContext) {
  const backend = {
    player: playerFixture(),
    playerFailures: 0,
    playerReads: 0,
    delayedPlayerResponse: null as Promise<number> | null,
    delayedPlayerReads: 0,
    catalogFailures: 0,
    catalogReads: 0,
    loginPosts: 0,
    historyReads: 0,
    guestPosts: 0,
    gameResponseDelayMs: 0,
    unexpectedRequests: [] as string[],
  };
  await context.addInitScript((token) => {
    localStorage.setItem('kampi.authToken', token);
  }, AUTH_TOKEN);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === new URL(WEB_URL).origin) return route.continue();
    const game = catalog.find((entry) => new URL(entry.clientUrl).origin === url.origin);
    if (game) {
      if (backend.gameResponseDelayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, backend.gameResponseDelayMs));
      return route.fulfill({ contentType: 'text/html', body: gameFrame(game.slug) });
    }
    if (url.origin !== API_ORIGIN) {
      backend.unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    const headers = { 'Access-Control-Allow-Origin': '*' };
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      });
    }
    if (url.pathname === '/games') {
      backend.catalogReads += 1;
      if (backend.catalogFailures > 0) {
        backend.catalogFailures -= 1;
        return json({ message: 'Catalog temporarily unavailable' }, 503);
      }
      return json({ games: catalog });
    }
    if (url.pathname === '/health/live') return json({ status: 'ok' });
    if (url.pathname === '/auth/config') return json({ guestAuthEnabled: true });
    if (url.pathname === '/stats/leaderboard') {
      return json({
        boards: [
          {
            gameSlug: 'penalty-duel',
            gameName: 'Penalty Duel',
            periodKey: '2026-W37',
            entries: [
              { rank: 1, userId: PLAYER_ID, displayName: 'Demo Challenger', score: 7 },
              {
                rank: 2,
                userId: '4d8357bb-ef8a-47d0-a15f-6bf864e141d5',
                displayName: 'River Storm',
                score: 6,
              },
              {
                rank: 3,
                userId: 'bd8c3cc2-a489-4bb3-ad8e-1c65e78b52df',
                displayName: 'Goal Guardian',
                score: 5,
              },
              ...['Corner King', 'Chip Champion', 'Sky Keeper', 'Final Whistle', 'Goal Line'].map(
                (displayName, index) => ({
                  rank: index + 4,
                  userId: `fixture-contender-${index}`,
                  displayName,
                  score: Math.max(1, 4 - index),
                }),
              ),
            ],
          },
          {
            gameSlug: 'rock-paper-scissors',
            gameName: 'Rock Paper Scissors',
            periodKey: '2026-W37',
            entries: [
              {
                rank: 1,
                userId: '1a776c29-87cc-4871-a9d7-a6d955c3bd82',
                displayName: 'Neon Ace',
                score: 4,
              },
              {
                rank: 2,
                userId: 'b0b60b20-52a2-4c14-914c-ae06bc84b3ac',
                displayName: 'The Playmaker',
                score: 3,
              },
            ],
          },
        ],
      });
    }
    if (url.pathname === '/players/me') {
      backend.playerReads += 1;
      if (
        request.headers().authorization === `Bearer ${AUTH_TOKEN}` &&
        backend.delayedPlayerResponse
      ) {
        const delayed = backend.delayedPlayerResponse;
        backend.delayedPlayerResponse = null;
        backend.delayedPlayerReads += 1;
        return json({ message: 'Previous session expired' }, await delayed);
      }
      if (backend.playerFailures > 0) {
        backend.playerFailures -= 1;
        return json({ message: 'Temporary API outage' }, 500);
      }
      if (
        ![AUTH_TOKEN, NEW_AUTH_TOKEN].some(
          (token) => request.headers().authorization === `Bearer ${token}`,
        )
      ) {
        return json({ message: 'Invalid test session' }, 401);
      }
      return json(backend.player);
    }
    if (url.pathname === '/matches/history') {
      backend.historyReads += 1;
      return json(history);
    }
    if (url.pathname === '/auth/guest') {
      backend.guestPosts += 1;
      return json({ message: 'A saved session must not be replaced' }, 503);
    }
    if (url.pathname === '/auth/login' && request.method() === 'POST') {
      backend.loginPosts += 1;
      const credentials = request.postDataJSON() as { email: string; password: string };
      if (credentials.email !== backend.player.email || credentials.password !== LOGIN_PASSWORD) {
        return json({ message: 'Invalid fixture credentials' }, 401);
      }
      return json({ token: NEW_AUTH_TOKEN });
    }
    backend.unexpectedRequests.push(`${request.method()} ${url.pathname}`);
    return json({ message: 'Unmocked test endpoint' }, 404);
  });
  return backend;
}

async function openLobby(page: Page, waitForPlayer = true) {
  await page.goto(WEB_URL);
  await expect(page.getByRole('button', { name: 'Play Penalty Duel', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Play Rock Paper Scissors', exact: true }),
  ).toBeVisible();
  if (waitForPlayer) {
    await expect(page.getByRole('button', { name: /^Balance: 2,586 chips/ })).toBeVisible();
  }
}

test.beforeEach(({ baseURL, page }, testInfo) => {
  // The default game test configuration discovers this file too. Only the separate
  // web configuration should execute it; the existing game suite stays independent.
  test.skip(testInfo.project.name !== 'web-lobby' || !baseURL, 'Run with playwright.web.config.ts');
  const issues: string[] = [];
  pageIssues.set(page, issues);
  page.on('pageerror', (error) => issues.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.origin === new URL(WEB_URL).origin &&
      (url.pathname.startsWith('/art/') || url.pathname.startsWith('/_next/')) &&
      response.status() >= 400
    ) {
      issues.push(`${response.status()} ${url.pathname}`);
    }
  });
});

test.afterEach(({ page }, testInfo) => {
  if (testInfo.project.name === 'web-lobby') {
    expect(pageIssues.get(page) ?? [], 'No runtime errors or missing frontend assets').toEqual([]);
  }
});

for (const { width, height } of [
  { width: 320, height: 900 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 844, height: 390 },
  { width: 900, height: 1440 },
  { width: 1344, height: 752 },
  { width: 1440, height: 950 },
  { width: 1920, height: 1080 },
]) {
  test(`lobby and navigation fit a ${width}x${height}px viewport`, async ({ context, page }) => {
    const backend = await mockBackend(context);
    await page.setViewportSize({ width, height });
    await openLobby(page);
    await expect(page.getByRole('button', { name: 'Kampi home', exact: true })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    for (const name of ['Battle', 'Leaderboards', 'Shop', 'Profile', 'Edit']) {
      await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await expect
      .poll(() =>
        page.locator('img:visible').evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every((image) => {
              const graphic = image as HTMLImageElement;
              return graphic.complete && graphic.naturalWidth > 0;
            }),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.locator('.game-card').evaluateAll((cards) => {
          if (cards.length !== 2) return Number.POSITIVE_INFINITY;
          return Math.abs(
            cards[0]!.getBoundingClientRect().top - cards[1]!.getBoundingClientRect().top,
          );
        }),
      )
      .toBeLessThanOrEqual(1);
    const cardLayouts = await page.locator('.game-card').evaluateAll((cards) =>
      cards.map((card) => {
        const play = card.querySelector<HTMLButtonElement>('.play-button');
        const footer = card.querySelector<HTMLElement>('.game-card-body');
        const economy = card.querySelector<HTMLElement>('.game-economy');
        const graphic = play?.querySelector('img');
        if (!play || !footer || !economy || !graphic)
          throw new Error('Game card controls are missing');
        const cardBounds = card.getBoundingClientRect();
        const playBounds = play.getBoundingClientRect();
        const footerBounds = footer.getBoundingClientRect();
        const graphicBounds = graphic.getBoundingClientRect();
        // The economy wrapper can span the footer; its coin and text define its visible edge.
        const economyRight = Math.max(
          ...Array.from(economy.children, (child) => child.getBoundingClientRect().right),
        );
        return {
          name: card.querySelector('h3')?.textContent ?? 'Game',
          ratio: cardBounds.width / cardBounds.height,
          playWidthRatio: playBounds.width / cardBounds.width,
          artworkCenterX:
            (graphicBounds.left + graphicBounds.width / 2 - cardBounds.left) / cardBounds.width,
          artworkCenterY:
            (graphicBounds.top + graphicBounds.height / 2 - cardBounds.top) / cardBounds.height,
          // DOMRect float precision during entrance transforms can report 43.99997 for 44px.
          playWidth: Math.round(playBounds.width * 100) / 100,
          playHeight: Math.round(playBounds.height * 100) / 100,
          playLeft: playBounds.left,
          economyRight,
          graphicFitsFooter:
            graphicBounds.width > 0 &&
            graphicBounds.left >= footerBounds.left - 1 &&
            graphicBounds.right <= footerBounds.right + 1,
        };
      }),
    );
    for (const card of cardLayouts) {
      expect(
        card.ratio,
        `${card.name} keeps the reference card proportions`,
      ).toBeGreaterThanOrEqual(1.1);
      expect(card.ratio, `${card.name} keeps the reference card proportions`).toBeLessThanOrEqual(
        1.22,
      );
      expect(card.playWidthRatio, `${card.name} keeps Play compact`).toBeLessThanOrEqual(0.45);
      expect(
        card.artworkCenterX,
        `${card.name} Play matches the reference horizontal anchor`,
      ).toBeCloseTo(0.7532, 2);
      expect(
        card.artworkCenterY,
        `${card.name} Play matches the reference vertical anchor`,
      ).toBeCloseTo(0.8447, 2);
      expect(card.playWidth, `${card.name} Play has a usable touch target`).toBeGreaterThanOrEqual(
        44,
      );
      expect(card.playHeight, `${card.name} Play has a usable touch target`).toBeGreaterThanOrEqual(
        44,
      );
      expect(
        card.playLeft,
        `${card.name} Play stays to the right of the economy`,
      ).toBeGreaterThanOrEqual(card.economyRight - 1);
      expect(card.graphicFitsFooter, `${card.name} Play artwork stays within the footer`).toBe(
        true,
      );
    }
    const labelBounds = await navigation.locator('button .nav-icon img').evaluateAll((labels) =>
      labels.map((label) => ({
        text: label.closest('button')?.getAttribute('aria-label'),
        bottom: label.getBoundingClientRect().bottom,
      })),
    );
    expect(labelBounds).toHaveLength(5);
    for (const label of labelBounds) {
      expect(label.bottom, `${label.text} label remains within the screen`).toBeLessThanOrEqual(
        height,
      );
    }
    const dockArt = await navigation.locator('button .nav-icon img').evaluateAll((images) =>
      images.map((image) => {
        const bounds = image.getBoundingClientRect();
        return {
          centerX: (bounds.left + bounds.width / 2) / innerWidth,
          width: bounds.width,
          bottom: bounds.bottom,
        };
      }),
    );
    const dockCenters =
      width >= 1100 ? [0.1354, 0.2649, 0.5, 0.7143, 0.8348] : [0.0844, 0.2489, 0.5, 0.7444, 0.9022];
    const dockScale =
      height <= 500 && width > height
        ? 0.44
        : width >= 1100
          ? 0.81
          : Math.min(1.2, Math.max(0.5, width / 900));
    for (const [index, graphic] of dockArt.entries()) {
      expect(graphic.centerX, 'Dock artwork follows the reference positions').toBeCloseTo(
        dockCenters[index]!,
        3,
      );
      expect(graphic.width, 'Dock icon and caption retain the reference scale').toBeCloseTo(
        (index === 2 ? 156 : 115) * dockScale,
        0,
      );
    }
    expect(dockArt[2]!.bottom, 'Battle is raised above the neighboring labels').toBeLessThan(
      dockArt[0]!.bottom - 7 * dockScale,
    );
    const rewardLayout = await page.locator('.rewards-banner').evaluate((banner) => {
      const bounds = banner.getBoundingClientRect();
      const graphic = banner.querySelector('.reward-button img')!.getBoundingClientRect();
      const copy = banner.querySelector('.rewards-description')!.getBoundingClientRect();
      return {
        bottom: graphic.bottom,
        panelBottom: bounds.bottom,
        top: graphic.top,
        copyBottom: copy.bottom,
        widthRatio: graphic.width / bounds.width,
      };
    });
    expect(rewardLayout.bottom, 'Reward art has space above the lower border').toBeLessThan(
      rewardLayout.panelBottom - 8,
    );
    expect(rewardLayout.top, 'Reward art does not overlap the subtitle').toBeGreaterThan(
      rewardLayout.copyBottom,
    );
    expect(rewardLayout.widthRatio).toBeLessThanOrEqual(0.33);
    if (width >= 1100) {
      const rail = await navigation.boundingBox();
      expect(rail).not.toBeNull();
      for (const game of catalog) {
        const play = await page
          .getByRole('button', { name: `Play ${game.name}`, exact: true })
          .boundingBox();
        expect(play).not.toBeNull();
        expect(
          play!.y + play!.height,
          `${game.name} action clears the fixed navigation`,
        ).toBeLessThanOrEqual(rail!.y + 5);
      }
    }
    const captureName =
      width === 390
        ? 'mobile'
        : width === 1440
          ? 'desktop'
          : width === 900
            ? 'reference-portrait'
            : width === 1344
              ? 'reference-wide'
              : undefined;
    if (process.env.WEB_TEST_CAPTURE_DIR && captureName) {
      await expect(page.locator('.contender:not([aria-hidden="true"])')).toHaveCount(10);
      await expect(
        page.getByRole('button', { name: 'Play Penalty Duel', exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        path: join(process.env.WEB_TEST_CAPTURE_DIR, `kampi-lobby-${captureName}.png`),
        animations: 'disabled',
      });
      const metrics = await page.evaluate(() => ({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        paints: performance
          .getEntriesByType('paint')
          .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
        assets: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
          .filter((entry) => {
            const url = new URL(entry.name);
            return (
              url.origin === location.origin &&
              (url.pathname.startsWith('/art/') || url.pathname.startsWith('/_next/'))
            );
          })
          .map((entry) => ({
            path: new URL(entry.name).pathname,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
            transferSize: entry.transferSize,
            duration: entry.duration,
          })),
      }));
      await writeFile(
        join(process.env.WEB_TEST_CAPTURE_DIR, `kampi-lobby-${captureName}-metrics.json`),
        `${JSON.stringify(metrics, null, 2)}\n`,
      );
    }
    await page.getByRole('button', { name: 'View rewards', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Your rewards' }).getByText('625', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    expect(backend.guestPosts).toBe(0);
    expect(backend.unexpectedRequests).toEqual([]);
  });
}

test('saved player can navigate to real previous matches, rankings and profile', async ({
  context,
  page,
}) => {
  const backend = await mockBackend(context);
  await openLobby(page);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Previous matches/ })
    .click();
  await expect(page.getByText('Previous Rival', { exact: false })).toBeVisible();
  await expect(page.getByText('3 – 1', { exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await nav.getByRole('button', { name: 'Leaderboards', exact: true }).click();
  await expect(page.getByText('1. Demo Challenger', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByText('challenger@example.test', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Battle', exact: true }).click();
  await nav.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your account' })).toBeVisible();
  expect(backend.historyReads).toBeGreaterThan(0);
  expect(backend.guestPosts).toBe(0);
  expect(backend.unexpectedRequests).toEqual([]);
});

test('penalty iframe receives the saved session and restores after page reload', async ({
  context,
  page,
}) => {
  const backend = await mockBackend(context);
  await openLobby(page);
  await page.getByRole('button', { name: 'Play Penalty Duel', exact: true }).click();
  const frame = page.frameLocator('#game-frame');
  await expect(frame.getByTestId('session-player')).toHaveText(PLAYER_ID);
  expect(await page.evaluate(() => sessionStorage.getItem('kampi.activeGame'))).toBe(
    'penalty-duel',
  );
  expect(
    await frame
      .locator('body')
      .evaluate(
        () =>
          (window as unknown as { receivedSession: { authToken: string } }).receivedSession
            .authToken,
      ),
  ).toBe(AUTH_TOKEN);
  await page.reload();
  await expect(page.frameLocator('#game-frame').getByTestId('session-player')).toHaveText(
    PLAYER_ID,
  );
  await page.getByRole('button', { name: 'Back to lobby', exact: false }).click();
  await expect(page.locator('#game-frame')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('kampi.activeGame'))).toBeNull();
  await page.getByRole('button', { name: 'Play Rock Paper Scissors', exact: true }).click();
  await expect(page.frameLocator('#game-frame').getByTestId('session-player')).toHaveText(
    PLAYER_ID,
  );
  expect(backend.unexpectedRequests).toEqual([]);
});

test('slow penalty iframe shows useful progress instead of a blank panel', async ({
  context,
  page,
}) => {
  const backend = await mockBackend(context);
  backend.gameResponseDelayMs = 6500;
  await openLobby(page);
  await page.getByRole('button', { name: 'Play Penalty Duel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Loading Penalty Duel');
  await expect(page.getByRole('status')).toContainText('Slower connection detected', {
    timeout: 6200,
  });
  await expect(page.frameLocator('#game-frame').getByTestId('session-player')).toHaveText(
    PLAYER_ID,
  );
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(backend.unexpectedRequests).toEqual([]);
});

test('temporary player API failure preserves the saved identity and recovers online', async ({
  context,
  page,
}) => {
  const backend = await mockBackend(context);
  backend.playerFailures = 1;
  await openLobby(page, false);
  await expect.poll(() => backend.playerReads).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => localStorage.getItem('kampi.authToken'))).toBe(AUTH_TOKEN);
  expect(backend.guestPosts).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('button', { name: 'Profile', exact: true })
    .click();
  await expect(page.getByText('challenger@example.test', { exact: true })).toBeVisible();
  expect(backend.guestPosts).toBe(0);
  expect(backend.unexpectedRequests).toEqual([]);
});

test('catalog failure shows a retry even when the health endpoint succeeds', async ({
  context,
  page,
}) => {
  const backend = await mockBackend(context);
  backend.catalogFailures = 1;
  await page.goto(WEB_URL);
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Penalty Duel', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('The next games are warming up. Check back shortly.', { exact: true }),
  ).toHaveCount(0);
  await retry.click();
  await expect(page.getByRole('button', { name: 'Play Penalty Duel', exact: true })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Play Rock Paper Scissors', exact: true }),
  ).toBeEnabled();
  await expect(retry).toHaveCount(0);
  expect(backend.catalogReads).toBe(2);
  expect(backend.guestPosts).toBe(0);
  expect(backend.unexpectedRequests).toEqual([]);
});

test('delayed bootstrap rejection cannot clear a newer manual login', async ({ context, page }) => {
  const backend = await mockBackend(context);
  let releasePreviousSession!: (status: number) => void;
  backend.delayedPlayerResponse = new Promise<number>((resolve) => {
    releasePreviousSession = resolve;
  });
  await openLobby(page, false);
  await expect.poll(() => backend.delayedPlayerReads).toBe(1);
  const profile = page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('button', { name: 'Profile', exact: true });
  await profile.click();
  await page.getByLabel('Email', { exact: true }).fill(backend.player.email);
  await page.getByLabel('Password', { exact: true }).fill(LOGIN_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole('button', { name: /^Balance: 2,586 chips/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kampi.authToken'))).toBe(NEW_AUTH_TOKEN);
  const rejected = page.waitForResponse(
    (response) => response.url() === `${API_ORIGIN}/players/me` && response.status() === 401,
  );
  releasePreviousSession(401);
  await (await rejected).finished();
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => localStorage.getItem('kampi.authToken'))).toBe(NEW_AUTH_TOKEN);
  await profile.click();
  await expect(page.getByText(backend.player.email, { exact: true })).toBeVisible();
  expect(backend.loginPosts).toBe(1);
  expect(backend.guestPosts).toBe(0);
  expect(backend.unexpectedRequests).toEqual([]);
});

test('menu traps keyboard focus and Escape returns focus to its trigger', async ({
  context,
  page,
}) => {
  await mockBackend(context);
  await openLobby(page);
  const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Your arena' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close menu', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: /^Shop/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close menu', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('player strip includes deeper ranks, scrolls left, pauses and loops without a gap', async ({
  context,
  page,
}) => {
  await mockBackend(context);
  await page.setViewportSize({ width: 1440, height: 950 });
  await openLobby(page);
  await expect(page.locator('.contender:not([aria-hidden="true"])')).toHaveCount(10);
  await expect(
    page.locator('.contender:not([aria-hidden="true"])').getByText('Goal Line'),
  ).toHaveCount(1);
  const track = page.locator('.contender-track');
  const readX = () =>
    track.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41);
  const startX = await readX();
  await expect.poll(readX).toBeLessThan(startX - 5);
  await page.getByRole('button', { name: 'Pause player strip', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect
    .poll(() => track.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');
  await page.getByRole('button', { name: 'Resume player strip', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect
    .poll(() => track.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('running');
  const loop = await track.evaluate((element) => {
    const halves = Array.from(element.children);
    const animation = element.getAnimations()[0]!;
    const duration = Number(animation.effect!.getTiming().duration);
    animation.pause();
    animation.currentTime = duration * 0.25;
    const firstX = new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
    animation.currentTime = duration * 1.25;
    const nextX = new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
    return {
      sameContent: halves[0]!.textContent === halves[1]!.textContent,
      halfWidth: halves[0]!.getBoundingClientRect().width,
      viewportWidth: element.parentElement!.getBoundingClientRect().width,
      displacement: Math.abs(firstX - nextX),
      iterations: animation.effect!.getTiming().iterations,
    };
  });
  expect(loop.sameContent).toBe(true);
  expect(loop.halfWidth).toBeGreaterThan(loop.viewportWidth);
  expect(loop.displacement).toBeLessThan(1);
  expect(loop.iterations).toBe(Infinity);
});

test('reduced motion disables entrance animations without preventing play', async ({
  context,
  page,
}) => {
  await mockBackend(context);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLobby(page);
  await expect
    .poll(() =>
      page
        .locator('.game-card, .card-underglow')
        .evaluateAll((cards) => cards.map((card) => getComputedStyle(card).animationName)),
    )
    .toEqual(['none', 'none', 'none', 'none']);
  await expect(page.getByRole('button', { name: 'Pause player strip', exact: true })).toBeHidden();
  expect(
    await page
      .locator('.contender-track')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.getByRole('button', { name: 'Play Penalty Duel', exact: true }).click();
  await expect(page.frameLocator('#game-frame').getByTestId('session-player')).toHaveText(
    PLAYER_ID,
  );
});

test.describe('Mobile H5 touch interaction', () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    viewport: { width: 390, height: 844 },
  });

  test('retina touch lobby opens rewards and launches a penalty session', async ({
    context,
    page,
  }) => {
    const backend = await mockBackend(context);
    await openLobby(page);
    await page.waitForLoadState('networkidle');
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    const layout = await navigation.locator('button > span:last-child').evaluateAll((labels) => ({
      width: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      labels: labels.map((label) => {
        const bounds = label.getBoundingClientRect();
        return {
          text: label.textContent,
          fits:
            bounds.left >= 0 &&
            bounds.right <= window.innerWidth &&
            bounds.bottom <= window.innerHeight,
        };
      }),
    }));
    expect(layout.width).toBe(390);
    expect(layout.overflow).toBe(false);
    expect(layout.labels).toHaveLength(5);
    for (const label of layout.labels)
      expect(label.fits, `${label.text} fits the touch viewport`).toBe(true);
    if (process.env.WEB_TEST_CAPTURE_DIR) {
      const metrics = await page.evaluate(() => ({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio,
        assets: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
          .filter(
            (entry) =>
              new URL(entry.name).origin === location.origin &&
              new URL(entry.name).pathname.startsWith('/art/'),
          )
          .map((entry) => ({
            path: new URL(entry.name).pathname,
            encodedBodySize: entry.encodedBodySize,
            transferSize: entry.transferSize,
          })),
      }));
      await writeFile(
        join(process.env.WEB_TEST_CAPTURE_DIR, 'mobile-retina-metrics.json'),
        `${JSON.stringify(metrics, null, 2)}\n`,
      );
    }
    await page.getByRole('button', { name: 'View rewards', exact: true }).tap();
    await expect(
      page.getByRole('region', { name: 'Your rewards' }).getByText('625', { exact: true }),
    ).toBeVisible();
    await navigation.getByRole('button', { name: 'Battle', exact: true }).tap();
    await page.getByRole('button', { name: 'Play Penalty Duel', exact: true }).tap();
    await expect(page.frameLocator('#game-frame').getByTestId('session-player')).toHaveText(
      PLAYER_ID,
    );
    expect(backend.guestPosts).toBe(0);
    expect(backend.unexpectedRequests).toEqual([]);
  });
});
