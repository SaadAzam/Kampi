# Kampi lobby redesign — 10 September 2026

The web lobby now follows the supplied navy, gold and metallic arena artwork, with layouts for phones, tablets, landscape devices and desktop screens. It displays the two real active games from the API; it does not invent extra games or online-player counts to fill the reference layout.

## Presentation and interaction

- Supplied logo, reward crest, coin, player frames and navigation icons; CSS supplies scalable panels, bevels and lighting.
- New RPS illustration and a more detailed penalty illustration for desktop and high-density screens. Original penalty slices remain in use at smaller sizes.
- Responsive game artwork with AVIF sources, WebP fallbacks and explicit dimensions/aspect ratios. The browser downloads only the selected candidate.
- Finite entrance animations and banner shimmer, desktop card/illustration hover movement, button press feedback, animated menu entry and navigation highlights. Reduced-motion preferences disable transitions and animations.
- Five working navigation destinations: history, leaderboards, battle, shop and profile. The native menu includes all destinations and rewards, traps keyboard focus, closes on Escape, and restores focus. View navigation focuses the new heading.
- Touch targets, narrow-screen card stacking, horizontal player-card scrolling, iOS safe-area padding, and compact desktop layouts that keep both Play buttons clear of the fixed dock.

Rewards show actual earned XP, levels and wins. The shop is clearly marked coming soon because there is no purchasing endpoint. History occupies the reference's Edit slot because profile editing is not implemented. Login, registration and guest-account claiming remain available in Profile.

## Loading and connection handling

The shell renders independently of the API. Catalog, authentication and leaderboard requests no longer form a serial startup waterfall. Requests have an eight-second response deadline. Catalog failures show retry controls; offline/online and visibility events support automatic recovery.

Temporary player API errors preserve the saved identity. Only explicit authorization rejection invalidates a saved session during bootstrap. An operation counter prevents delayed startup requests from replacing a newer login or logout. A saved game only restores after its player has been validated. Existing origin-checked iframe session delivery, match-result refreshes, balances and history are retained.

No animation library, external webfont, video background or runtime image-conversion dependency was added. Decorative files are served with a one-day cache lifetime and stale-while-revalidate. When replacing deployed art, use new filenames to invalidate existing cached copies.

## Asset budget and provenance

Measured compressed artwork bodies from cold Chromium browser contexts against the production preview:

| Browser viewport | Artwork |
| --- | ---: |
| 390 × 844, 1× density | 86,113 bytes |
| 390 × 844, 3× density with touch | 125,842 bytes |
| 1440 × 950, 1× density | 113,910 bytes |

The same run transferred approximately 126 KB of compressed JavaScript and 7.7 KB of compressed CSS. These are fixture-backed local measurements, not a promise of a particular production loading time. API latency, network conditions, cache state and device speed still determine real loading time.

Final delivery assets are in `apps/web/public/art/lobby/`. `manifest.json` records sizes for converted source slices. Generated-art prompts and compression settings are recorded in [RPS artwork](rps-art-prompt.md) and [penalty artwork](penalty-art-prompt.md); both used the built-in image generation tool. Large source PNGs and personal source-directory paths are not included in the build.

To regenerate the supplied slices, with Node 22 and repository dependencies installed:

```sh
node scripts/optimize-lobby-art.mjs "/path/to/kampi game slicing"
```

The optional preparation script uses Sharp from the existing Next image pipeline. It preserves alpha, strips source metadata, and does not enlarge the supplied raster slices. Normal builds consume the checked-in optimized files and do not need the source folder.

## Verification

- Web production build, lint, TypeScript checks and existing web unit test passed.
- Fourteen browser tests passed in Chromium and fourteen in WebKit.
- Viewports: 320 × 900, 390 × 844, 768 × 900, 844 × 390 landscape, 1440 × 950 and 1920 × 1080; an additional mobile H5 case uses touch and 3× pixel density.
- Checks cover horizontal overflow, image loading, dock-label visibility, desktop Play-button clearance, rewards, history, profile, rankings, keyboard focus, reduced motion, both game iframe handshakes, full-page game restoration, catalog failures, temporary player failures and delayed-login races.
- Interactive checks against the real local backend confirmed balance/rankings display, rewards/shop navigation, penalty launch and restoration of the same guest after a full refresh.

Browser tests isolate backend and game responses; they do not create production accounts or matches. WebKit emulation is useful Safari-engine coverage, not a claim of testing every physical iPhone.

Run the normal app with `pnpm dev` and open `http://localhost:3000`. For the isolated web test suite, start a production preview on port 3200 and run:

```sh
pnpm --filter @kampi/e2e exec playwright test --config playwright.web.config.ts
WEB_TEST_BROWSER=webkit pnpm --filter @kampi/e2e exec playwright test --config playwright.web.config.ts
```

`WEB_TEST_URL` can select another preview URL. `WEB_TEST_CAPTURE_DIR` writes screenshots and asset metrics. In this environment the tests ran in the official Playwright 1.62.1 container against the host's preview.

The prior Railway snapshot failure has a separate local [workflow recovery fix](railway-snapshot-fix-2026-09-10.md), with fourteen passing recovery tests. Nothing was committed, pushed or deployed during this update; the owner can review and commit all changed and new files together.
