import { describe, expect, it } from 'vitest';
import { PENALTY_GAME_ID } from '@kampi/game-penalty';

describe('game-penalty app', () => {
  it('targets penalty-duel', () => {
    expect(PENALTY_GAME_ID).toBe('penalty-duel');
  });
});
