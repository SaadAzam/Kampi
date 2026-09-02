import { z } from 'zod';
import type { GameManifest, RandomProvider, Seat } from '@kampi/game-sdk/common';
import { SeatSchema } from '@kampi/game-sdk/common';

export const PENALTY_GAME_ID = 'penalty-duel';

export const penaltyManifest: GameManifest = {
  gameId: PENALTY_GAME_ID,
  displayName: 'Penalty Duel',
  protocolVersion: '1.0.0',
  roomName: 'penalty-duel',
  clientLaunchPath: '/play/penalty-duel',
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ['PUBLIC', 'PRIVATE'],
  botCapable: true,
  configSchemaVersion: '1.0.0',
};

/** Directions are extensible (CENTER reserved for future versions). */
export const DirectionSchema = z.enum(['LEFT', 'RIGHT']);
export type Direction = z.infer<typeof DirectionSchema>;

export const PenaltyPhaseSchema = z.enum([
  'WAITING_FOR_PLAYERS',
  'STARTING',
  'AWAITING_ACTIONS',
  'REVEALING_RESULT',
  'NEXT_TURN',
  'FINISHED',
  'ABORTED',
]);
export type PenaltyPhase = z.infer<typeof PenaltyPhaseSchema>;

export const TurnOutcomeSchema = z.enum(['GOAL', 'SAVE', 'MISS']);
export type TurnOutcome = z.infer<typeof TurnOutcomeSchema>;

export const TimeoutReasonSchema = z.enum(['NONE', 'KICKER', 'GOALKEEPER', 'BOTH']);
export type TimeoutReason = z.infer<typeof TimeoutReasonSchema>;

export const FinishReasonSchema = z.enum([
  'REGULATION',
  'SUDDEN_DEATH',
  'FORFEIT',
  'ABORT',
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

export const PenaltyGameConfigSchema = z.object({
  regulationKicksPerPlayer: z.number().int().positive().default(3),
  decisionTimeMs: z.number().int().positive().default(10_000),
  revealDurationMs: z.number().int().positive().default(2_000),
  entryFee: z.string().default('500'),
  winnerPayout: z.string().default('950'),
  botFillAfterMs: z.number().int().positive().default(10_000),
  reconnectGraceMs: z.number().int().positive().default(30_000),
  directions: z.array(DirectionSchema).default(['LEFT', 'RIGHT']),
});
export type PenaltyGameConfig = z.infer<typeof PenaltyGameConfigSchema>;

export const ShootCommandSchema = z.object({
  type: z.literal('submit_action').default('submit_action'),
  protocolVersion: z.string(),
  gameId: z.literal(PENALTY_GAME_ID),
  matchId: z.string().uuid().optional(),
  commandId: z.string().uuid(),
  turnId: z.string().uuid(),
  action: z.enum(['SHOOT_LEFT', 'SHOOT_RIGHT', 'DIVE_LEFT', 'DIVE_RIGHT']),
});
export type ShootCommand = z.infer<typeof ShootCommandSchema>;

export type PendingActions = {
  shot: Direction | null;
  dive: Direction | null;
  shotCommandId: string | null;
  diveCommandId: string | null;
};

export type TurnResolveInput = {
  shot: Direction | null;
  dive: Direction | null;
  kickerTimedOut: boolean;
  goalkeeperTimedOut: boolean;
};

export type TurnResolveResult = {
  shot: Direction | null;
  dive: Direction | null;
  outcome: TurnOutcome;
  timeoutReason: TimeoutReason;
};

export function actionToDirection(
  action: ShootCommand['action'],
): { role: 'KICKER' | 'GOALKEEPER'; direction: Direction } {
  switch (action) {
    case 'SHOOT_LEFT':
      return { role: 'KICKER', direction: 'LEFT' };
    case 'SHOOT_RIGHT':
      return { role: 'KICKER', direction: 'RIGHT' };
    case 'DIVE_LEFT':
      return { role: 'GOALKEEPER', direction: 'LEFT' };
    case 'DIVE_RIGHT':
      return { role: 'GOALKEEPER', direction: 'RIGHT' };
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unsupported action ${_exhaustive}`);
    }
  }
}

/**
 * Authoritative turn resolution.
 * Same direction => SAVE; different => GOAL.
 * Kicker timeout => MISS (precedence over GK timeout).
 * GK timeout alone + valid shot => GOAL (NO_DIVE).
 */
export function resolvePenaltyTurn(input: TurnResolveInput): TurnResolveResult {
  const kickerTimedOut = input.kickerTimedOut || input.shot === null;
  const goalkeeperTimedOut = input.goalkeeperTimedOut || input.dive === null;

  if (kickerTimedOut && goalkeeperTimedOut) {
    return {
      shot: input.shot,
      dive: input.dive,
      outcome: 'MISS',
      timeoutReason: 'BOTH',
    };
  }
  if (kickerTimedOut) {
    return {
      shot: input.shot,
      dive: input.dive,
      outcome: 'MISS',
      timeoutReason: 'KICKER',
    };
  }
  if (goalkeeperTimedOut) {
    return {
      shot: input.shot,
      dive: null,
      outcome: 'GOAL',
      timeoutReason: 'GOALKEEPER',
    };
  }

  const shot = input.shot!;
  const dive = input.dive!;
  return {
    shot,
    dive,
    outcome: shot === dive ? 'SAVE' : 'GOAL',
    timeoutReason: 'NONE',
  };
}

export function oppositeSeat(seat: Seat): Seat {
  return seat === 'A' ? 'B' : 'A';
}

export function chooseFirstKicker(random: RandomProvider): Seat {
  return random.pick(['A', 'B'] as const);
}

export function rolesForSequence(firstKicker: Seat, sequence: number): {
  kickerSeat: Seat;
  goalkeeperSeat: Seat;
} {
  // Alternate every turn starting at sequence 1
  const kickerIsFirst = sequence % 2 === 1;
  const kickerSeat = kickerIsFirst ? firstKicker : oppositeSeat(firstKicker);
  return { kickerSeat, goalkeeperSeat: oppositeSeat(kickerSeat) };
}

export type MatchProgress = {
  regulationKicksPerPlayer: number;
  kicksTaken: Record<Seat, number>;
  scores: Record<Seat, number>;
  suddenDeathPair: number;
  inSuddenDeath: boolean;
};

export type MatchProgressDecision =
  | { type: 'CONTINUE_REGULATION' }
  | { type: 'ENTER_SUDDEN_DEATH' }
  | { type: 'CONTINUE_SUDDEN_DEATH' }
  | { type: 'FINISHED'; winnerSeat: Seat; reason: FinishReason };

export function applyTurnScore(
  scores: Record<Seat, number>,
  kickerSeat: Seat,
  outcome: TurnOutcome,
): Record<Seat, number> {
  if (outcome !== 'GOAL') return { ...scores };
  return {
    ...scores,
    [kickerSeat]: scores[kickerSeat] + 1,
  };
}

/**
 * After a completed turn, decide next phase.
 * Sudden death ends only after a complete pair when scores differ.
 */
export function decideMatchProgress(progress: MatchProgress): MatchProgressDecision {
  const { regulationKicksPerPlayer, kicksTaken, scores, suddenDeathPair, inSuddenDeath } =
    progress;
  const aDone = kicksTaken.A >= regulationKicksPerPlayer;
  const bDone = kicksTaken.B >= regulationKicksPerPlayer;

  if (!inSuddenDeath) {
    if (!aDone || !bDone) return { type: 'CONTINUE_REGULATION' };
    if (scores.A !== scores.B) {
      return {
        type: 'FINISHED',
        winnerSeat: scores.A > scores.B ? 'A' : 'B',
        reason: 'REGULATION',
      };
    }
    return { type: 'ENTER_SUDDEN_DEATH' };
  }

  // Sudden death: pair is complete when both have taken regulation + suddenDeathPair kicks
  const target = regulationKicksPerPlayer + suddenDeathPair;
  const pairComplete = kicksTaken.A >= target && kicksTaken.B >= target;
  if (!pairComplete) return { type: 'CONTINUE_SUDDEN_DEATH' };
  if (scores.A === scores.B) return { type: 'CONTINUE_SUDDEN_DEATH' };
  return {
    type: 'FINISHED',
    winnerSeat: scores.A > scores.B ? 'A' : 'B',
    reason: 'SUDDEN_DEATH',
  };
}

export function pickBotAction(
  role: 'KICKER' | 'GOALKEEPER',
  random: RandomProvider,
): ShootCommand['action'] {
  const direction = random.pick(['LEFT', 'RIGHT'] as const);
  if (role === 'KICKER') {
    return direction === 'LEFT' ? 'SHOOT_LEFT' : 'SHOOT_RIGHT';
  }
  return direction === 'LEFT' ? 'DIVE_LEFT' : 'DIVE_RIGHT';
}

export function canSubmitRole(
  role: 'KICKER' | 'GOALKEEPER',
  action: ShootCommand['action'],
): boolean {
  const mapped = actionToDirection(action);
  return mapped.role === role;
}

export { SeatSchema };
export type { Seat };
