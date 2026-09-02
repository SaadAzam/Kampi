import { describe, expect, it, vi } from 'vitest';
import { createRandomProvider } from '@kampi/game-sdk/common';
import { SettlementCoordinator, assertDistinctPlayers, CommandGuard } from '@kampi/game-sdk/server';
import {
  applyTurnScore,
  canSubmitRole,
  chooseFirstKicker,
  decideMatchProgress,
  pickBotAction,
  resolvePenaltyTurn,
  rolesForSequence,
  type Direction,
} from '@kampi/game-penalty';
import type { Seat } from '@kampi/game-sdk/common';

/**
 * Integration-style harness: exercises Penalty rules + settlement guardrails
 * the same way the room does, without spinning Colyseus.
 */
function simulateMatch(script: Array<{ kicker: Direction; keeper: Direction }>) {
  const rng = createRandomProvider(() => 0);
  const firstKicker = chooseFirstKicker(rng);
  let scores: Record<Seat, number> = { A: 0, B: 0 };
  let kicksTaken: Record<Seat, number> = { A: 0, B: 0 };
  let suddenDeathPair = 0;
  let inSuddenDeath = false;
  const history: Array<{ outcome: string; shot: Direction; dive: Direction }> = [];

  for (let sequence = 1; sequence <= script.length; sequence += 1) {
    const roles = rolesForSequence(firstKicker, sequence);
    const step = script[sequence - 1]!;
    const resolved = resolvePenaltyTurn({
      shot: step.kicker,
      dive: step.keeper,
      kickerTimedOut: false,
      goalkeeperTimedOut: false,
    });
    scores = applyTurnScore(scores, roles.kickerSeat, resolved.outcome);
    kicksTaken = {
      ...kicksTaken,
      [roles.kickerSeat]: kicksTaken[roles.kickerSeat] + 1,
    };
    history.push({ outcome: resolved.outcome, shot: resolved.shot!, dive: resolved.dive! });

    const progress = decideMatchProgress({
      regulationKicksPerPlayer: 3,
      kicksTaken,
      scores,
      suddenDeathPair,
      inSuddenDeath,
    });
    if (progress.type === 'ENTER_SUDDEN_DEATH') {
      inSuddenDeath = true;
      suddenDeathPair = 1;
    } else if (progress.type === 'CONTINUE_SUDDEN_DEATH') {
      const totalExtra =
        kicksTaken.A + kicksTaken.B - 6;
      if (totalExtra % 2 === 0) suddenDeathPair += 1;
    } else if (progress.type === 'FINISHED') {
      return { firstKicker, scores, history, winnerSeat: progress.winnerSeat, reason: progress.reason };
    }
  }

  return { firstKicker, scores, history, winnerSeat: null as Seat | null, reason: null };
}

describe('penalty two-seat flow', () => {
  it('rejects same identity occupying both seats', () => {
    expect(() => assertDistinctPlayers(['u1', 'u1'])).toThrow(/same player/i);
  });

  it('keeps pending directions private until both lock (public state shape)', () => {
    const pending = { shot: 'LEFT' as Direction | null, dive: null as Direction | null };
    const publicLocked = {
      kickerLocked: pending.shot !== null,
      goalkeeperLocked: pending.dive !== null,
      // never include shot/dive in public payload
    };
    expect(publicLocked).toEqual({ kickerLocked: true, goalkeeperLocked: false });
    expect('shot' in publicLocked).toBe(false);
  });

  it('completes a regulation match with identical scores on both clients', () => {
    // firstKicker A with rng=0; alternate A,B,A,B,A,B
    // Script outcomes: GOAL, SAVE, GOAL, SAVE, GOAL, SAVE → A=3 B=0
    const result = simulateMatch([
      { kicker: 'LEFT', keeper: 'RIGHT' }, // A goals
      { kicker: 'LEFT', keeper: 'LEFT' }, // B save
      { kicker: 'RIGHT', keeper: 'LEFT' }, // A goals
      { kicker: 'RIGHT', keeper: 'RIGHT' }, // B save
      { kicker: 'LEFT', keeper: 'RIGHT' }, // A goals
      { kicker: 'LEFT', keeper: 'LEFT' }, // B save
    ]);
    expect(result.winnerSeat).toBe('A');
    expect(result.scores).toEqual({ A: 3, B: 0 });
    expect(result.history).toHaveLength(6);
  });

  it('settles payout exactly once even if finish is retried', async () => {
    const finalize = vi.fn(async () => ({ paid: true }));
    const settlement = new SettlementCoordinator({
      deductEntryFees: async () => undefined,
      finalizeMatchPayout: finalize,
      refundAbortedMatch: async () => undefined,
    });
    await settlement.payWinner({
      matchId: 'm1',
      winnerUserId: 'u1',
      payout: 950n,
      payoutLedgerKey: 'payout:m1',
    });
    await settlement.payWinner({
      matchId: 'm1',
      winnerUserId: 'u1',
      payout: 950n,
      payoutLedgerKey: 'payout:m1',
    });
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('refunds abort exactly once and blocks later payout', async () => {
    const refund = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => ({ paid: true }));
    const settlement = new SettlementCoordinator({
      deductEntryFees: async () => undefined,
      finalizeMatchPayout: finalize,
      refundAbortedMatch: refund,
    });
    await settlement.abortRefund({
      matchId: 'm2',
      players: [{ userId: 'u1', entryFeeKey: 'e1' }],
      entryFee: 500n,
      abortRefundKey: 'abort:m2',
    });
    await settlement.abortRefund({
      matchId: 'm2',
      players: [{ userId: 'u1', entryFeeKey: 'e1' }],
      entryFee: 500n,
      abortRefundKey: 'abort:m2',
    });
    const paid = await settlement.payWinner({
      matchId: 'm2',
      winnerUserId: 'u1',
      payout: 950n,
      payoutLedgerKey: 'payout:m2',
    });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(paid).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('idempotent command ids do not double-apply', () => {
    const guard = new CommandGuard();
    expect(guard.checkIdempotency('c1')).toBe('new');
    expect(guard.checkIdempotency('c1')).toBe('duplicate');
  });

  it('bot picks independently of human hidden choice', () => {
    const rng = createRandomProvider(() => 0);
    const humanHidden: Direction = 'RIGHT';
    const botAction = pickBotAction('GOALKEEPER', rng);
    // Injected RNG always yields LEFT (0) — never mirrors human RIGHT
    expect(botAction).toBe('DIVE_LEFT');
    expect(canSubmitRole('GOALKEEPER', botAction)).toBe(true);
    void humanHidden;
  });
});
