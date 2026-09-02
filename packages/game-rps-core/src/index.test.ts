import { describe, expect, it } from 'vitest';
import { resolveRpsRound, isMatchComplete, rpsManifest } from './index.js';

describe('rps-core', () => {
  it('exposes manifest', () => {
    expect(rpsManifest.gameId).toBe('rock-paper-scissors');
  });

  it('resolves rounds', () => {
    expect(resolveRpsRound('ROCK', 'SCISSORS')).toBe('PLAYER1');
    expect(isMatchComplete({ PLAYER1: 2, PLAYER2: 0 }, 3)).toBe('PLAYER1');
  });
});
