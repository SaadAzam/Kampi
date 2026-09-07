# Penalty Duel asset replacement

The presentation is separate from authoritative gameplay. HTML provides accessible controls, scores, timers, invitations, and results. Phaser draws and animates the pitch, keeper, and ball.

1. Put final sprites, atlases, or audio in `apps/game-penalty/public/assets/`.
2. Load asset keys in `GameScene.preload()` in `apps/game-penalty/src/scenes/GameScene.ts`.
3. Replace the primitives in `drawStadium()` with sprites. Retain layout coordinates derived from the scene width/height so rotation and embedding continue to work.
4. Map `shot`, `dive`, and `outcome` in `playReveal()` to the appropriate animations. Reveal history and `turnId` come from the server; animation completion must never advance or settle a match.
5. Preserve reduced-motion handling, visible HTML outcomes, and the accessible controls in `apps/game-penalty/index.html`.
6. Replace lobby `.game-art` placeholders in `apps/web/src/app/page.tsx` and its styles; retain the two-column responsive card structure and real game metadata.

No rule, payment, or server-state changes are needed when replacing graphics.
