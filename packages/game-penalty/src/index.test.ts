import { describe, expect, it } from 'vitest';
import { createRandomProvider } from '@kampi/game-sdk/common';
import {
  resolvePenaltyTurn,
  decideMatchProgress,
  rolesForSequence,
  chooseFirstKicker,
  applyTurnScore,
  canSubmitRole,
  pickBotAction,
  actionToDirection,
} from './index.js';

describe('resolvePenaltyTurn', () => {
  it('save when same direction', () => {
    expect(
      resolvePenaltyTurn({
        shot: 'LEFT',
        dive: 'LEFT',
        kickerTimedOut: false,
        goalkeeperTimedOut: false,
      }),
    ).toEqual({ shot: 'LEFT', dive: 'LEFT', outcome: 'SAVE', timeoutReason: 'NONE' });
  });

  it('goal when different direction', () => {
    expect(
      resolvePenaltyTurn({
        shot: 'LEFT',
        dive: 'RIGHT',
        kickerTimedOut: false,
        goalkeeperTimedOut: false,
      }).outcome,
    ).toBe('GOAL');
  });

  it('kicker timeout is miss', () => {
    expect(
      resolvePenaltyTurn({
        shot: null,
        dive: 'LEFT',
        kickerTimedOut: true,
        goalkeeperTimedOut: false,
      }),
    ).toMatchObject({ outcome: 'MISS', timeoutReason: 'KICKER' });
  });

  it('goalkeeper timeout alone is goal', () => {
    expect(
      resolvePenaltyTurn({
        shot: 'RIGHT',
        dive: null,
        kickerTimedOut: false,
        goalkeeperTimedOut: true,
      }),
    ).toMatchObject({ outcome: 'GOAL', timeoutReason: 'GOALKEEPER' });
  });

  it('both timeout prefers kicker miss', () => {
    expect(
      resolvePenaltyTurn({
        shot: null,
        dive: null,
        kickerTimedOut: true,
        goalkeeperTimedOut: true,
      }),
    ).toMatchObject({ outcome: 'MISS', timeoutReason: 'BOTH' });
  });
});

describe('roles and first kicker', () => {
  it('alternates roles each sequence', () => {
    const first = 'A' as const;
    expect(rolesForSequence(first, 1)).toEqual({ kickerSeat: 'A', goalkeeperSeat: 'B' });
    expect(rolesForSequence(first, 2)).toEqual({ kickerSeat: 'B', goalkeeperSeat: 'A' });
    expect(rolesForSequence(first, 3)).toEqual({ kickerSeat: 'A', goalkeeperSeat: 'B' });
  });

  it('chooses first kicker deterministically', () => {
    const rng = createRandomProvider(() => 0);
    expect(chooseFirstKicker(rng)).toBe('A');
  });
});

describe('regulation and sudden death', () => {
  it('continues until both complete three kicks', () => {
    expect(
      decideMatchProgress({
        regulationKicksPerPlayer: 3,
        kicksTaken: { A: 2, B: 3 },
        scores: { A: 1, B: 1 },
        suddenDeathPair: 0,
        inSuddenDeath: false,
      }).type,
    ).toBe('CONTINUE_REGULATION');
  });

  it('finishes regulation when scores differ', () => {
    const result = decideMatchProgress({
      regulationKicksPerPlayer: 3,
      kicksTaken: { A: 3, B: 3 },
      scores: { A: 2, B: 1 },
      suddenDeathPair: 0,
      inSuddenDeath: false,
    });
    expect(result).toEqual({ type: 'FINISHED', winnerSeat: 'A', reason: 'REGULATION' });
  });

  it('enters sudden death on tie', () => {
    expect(
      decideMatchProgress({
        regulationKicksPerPlayer: 3,
        kicksTaken: { A: 3, B: 3 },
        scores: { A: 2, B: 2 },
        suddenDeathPair: 0,
        inSuddenDeath: false,
      }).type,
    ).toBe('ENTER_SUDDEN_DEATH');
  });

  it('does not finish sudden death mid-pair', () => {
    expect(
      decideMatchProgress({
        regulationKicksPerPlayer: 3,
        kicksTaken: { A: 4, B: 3 },
        scores: { A: 3, B: 2 },
        suddenDeathPair: 1,
        inSuddenDeath: true,
      }).type,
    ).toBe('CONTINUE_SUDDEN_DEATH');
  });

  it('finishes after complete sudden-death pair when scores differ', () => {
    const result = decideMatchProgress({
      regulationKicksPerPlayer: 3,
      kicksTaken: { A: 4, B: 4 },
      scores: { A: 3, B: 2 },
      suddenDeathPair: 1,
      inSuddenDeath: true,
    });
    expect(result).toEqual({ type: 'FINISHED', winnerSeat: 'A', reason: 'SUDDEN_DEATH' });
  });

  it('continues sudden death when still tied after a pair', () => {
    expect(
      decideMatchProgress({
        regulationKicksPerPlayer: 3,
        kicksTaken: { A: 4, B: 4 },
        scores: { A: 3, B: 3 },
        suddenDeathPair: 1,
        inSuddenDeath: true,
      }).type,
    ).toBe('CONTINUE_SUDDEN_DEATH');
  });
});

describe('commands and bot', () => {
  it('rejects wrong-role actions', () => {
    expect(canSubmitRole('KICKER', 'DIVE_LEFT')).toBe(false);
    expect(canSubmitRole('GOALKEEPER', 'SHOOT_LEFT')).toBe(false);
    expect(canSubmitRole('KICKER', 'SHOOT_RIGHT')).toBe(true);
  });

  it('maps actions and picks bot deterministically', () => {
    expect(actionToDirection('SHOOT_LEFT')).toEqual({ role: 'KICKER', direction: 'LEFT' });
    const rng = createRandomProvider(() => 0.9);
    expect(pickBotAction('KICKER', rng)).toBe('SHOOT_RIGHT');
  });

  it('applies goal scores', () => {
    expect(applyTurnScore({ A: 0, B: 0 }, 'A', 'GOAL')).toEqual({ A: 1, B: 0 });
    expect(applyTurnScore({ A: 1, B: 0 }, 'A', 'SAVE')).toEqual({ A: 1, B: 0 });
  });
});
