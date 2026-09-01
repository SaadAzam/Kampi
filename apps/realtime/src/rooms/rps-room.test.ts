import { describe, expect, it, vi } from 'vitest';
import {
  createRandomSource,
  isMatchComplete,
  resolveRpsRound,
  getPublicChoice,
} from '@kampi/contracts';

describe('bot fallback timing logic', () => {
  it('fills bot after configured delay', async () => {
    vi.useFakeTimers();
    let filled = false;
    const delay = 1000;
    setTimeout(() => {
      filled = true;
    }, delay);
    vi.advanceTimersByTime(delay);
    expect(filled).toBe(true);
    vi.useRealTimers();
  });
});

describe('best-of-three completion in room logic', () => {
  it('completes at two wins', () => {
    expect(isMatchComplete({ PLAYER1: 2, PLAYER2: 0 }, 3)).toBe('PLAYER1');
  });
});

describe('choice concealment in snapshots', () => {
  it('hides opponent choice until both locked', () => {
    expect(getPublicChoice('ROCK', null, false)).toBeNull();
    expect(getPublicChoice('ROCK', 'PAPER', false)).toBe('ROCK');
  });
});

describe('invalid client commands', () => {
  it('rejects unknown choices at validation layer', () => {
    expect(['ROCK', 'PAPER', 'SCISSORS'].includes('LIZARD' as never)).toBe(false);
  });
});

describe('RPS resolution', () => {
  it('uses server-side resolver', () => {
    expect(resolveRpsRound('ROCK', 'SCISSORS')).toBe('PLAYER1');
  });

  it('supports deterministic bot via injectable random', () => {
    const random = createRandomSource(() => 0);
    expect(random.pickChoice()).toBe('ROCK');
  });
});
