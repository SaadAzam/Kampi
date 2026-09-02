# Asset replacement guide (Penalty Duel)

Placeholder presentation uses Phaser primitives (goal box, keeper rectangle, ball circle, tweens). Replace art without touching authority.

## Presentation adapter

Animation states: `IDLE`, `KICK_LEFT`, `KICK_RIGHT`, `DIVE_LEFT`, `DIVE_RIGHT`, `GOAL`, `SAVE`, `MISS`, `RESET`.

Drive transitions from the server `reveal` / snapshot history (`turnId`), never from speculative client prediction.

## Replacement steps

1. Drop sprites/atlas/clips under `apps/game-penalty/public/assets/` (or a future CDN with hashed URLs).
2. Register keys in a preload/asset manifest scene.
3. Map each `AnimState` to a sprite animation or short transparent clip.
4. Keep ball/keeper motion keyed off reveal payload fields (`shot`, `dive`, `outcome`).
5. Respect `prefers-reduced-motion` — skip tweens, show outcome text only.
6. Do not let animation completion call any match-advance API; the server timeline is authoritative.

Pre-rendered transparent 3D clips are fine later; gameplay logic must remain independent of art format.
