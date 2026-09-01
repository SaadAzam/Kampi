import { describe, expect, it } from 'vitest';
import {
  getPublicChoice,
  isMatchComplete,
  resolveRpsRound,
  shouldConcealChoice,
} from './rps.js';

describe('resolveRpsRound', () => {
  it('resolves rock beats scissors', () => {
    expect(resolveRpsRound('ROCK', 'SCISSORS')).toBe('PLAYER1');
    expect(resolveRpsRound('SCISSORS', 'ROCK')).toBe('PLAYER2');
  });

  it('resolves paper beats rock', () => {
    expect(resolveRpsRound('PAPER', 'ROCK')).toBe('PLAYER1');
  });

  it('resolves scissors beats paper', () => {
    expect(resolveRpsRound('SCISSORS', 'PAPER')).toBe('PLAYER1');
  });

  it('returns draw for same choice', () => {
    expect(resolveRpsRound('ROCK', 'ROCK')).toBe('DRAW');
  });
});

describe('isMatchComplete', () => {
  it('completes best-of-three at 2 wins', () => {
    expect(isMatchComplete({ PLAYER1: 2, PLAYER2: 0 }, 3)).toBe('PLAYER1');
    expect(isMatchComplete({ PLAYER1: 1, PLAYER2: 2 }, 3)).toBe('PLAYER2');
    expect(isMatchComplete({ PLAYER1: 1, PLAYER2: 1 }, 3)).toBeNull();
  });
});

describe('choice concealment', () => {
  it('conceals until both locked or expired', () => {
    expect(shouldConcealChoice('ROCK', null, false)).toBe(true);
    expect(shouldConcealChoice('ROCK', 'PAPER', false)).toBe(false);
    expect(shouldConcealChoice('ROCK', null, true)).toBe(false);
  });

  it('returns null for concealed choices', () => {
    expect(getPublicChoice('ROCK', null, false)).toBeNull();
    expect(getPublicChoice('ROCK', 'PAPER', false)).toBe('ROCK');
  });
});
