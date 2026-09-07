import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import type { RpsChoice, RpsMatchSnapshot } from '@kampi/contracts';
import { getPublicChoice } from '@kampi/contracts';

export class PlayerState extends Schema {
  @type('string') slot: 'PLAYER1' | 'PLAYER2' = 'PLAYER1';
  @type('string') sessionId: string = '';
  @type('string') userId: string = '';
  @type('string') displayName: string = '';
  @type('string') kind: 'HUMAN' | 'BOT' = 'HUMAN';
  @type('number') score: number = 0;
  @type('boolean') connected: boolean = true;
  @type('boolean') choiceLocked: boolean = false;
  // Server-only: decorating this field would leak hidden choices through schema patches.
  choice: RpsChoice | '' = '';
}

export class RoundState extends Schema {
  @type('number') roundNumber: number = 0;
  @type('string') outcome: 'PLAYER1' | 'PLAYER2' | 'DRAW' | '' = '';
  @type('string') player1Choice: RpsChoice | '' = '';
  @type('string') player2Choice: RpsChoice | '' = '';
}

export class RpsRoomState extends Schema {
  @type('string') matchId: string = '';
  @type('string') status: 'WAITING' | 'ACTIVE' | 'RESOLVING' | 'FINISHED' | 'ABORTED' = 'WAITING';
  @type('number') bestOf: number = 3;
  @type('number') currentRound: number = 0;
  @type('number') roundDeadlineMs: number = 0;
  @type('string') winnerSlot: 'PLAYER1' | 'PLAYER2' | '' = '';
  @type('string') abortReason: string = '';
  @type('boolean') botFill: boolean = false;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([RoundState]) rounds = new ArraySchema<RoundState>();
}

export function buildSnapshot(state: RpsRoomState, roundExpired: boolean): RpsMatchSnapshot {
  const players = Array.from(state.players.values()).map((player) => ({
    slot: player.slot,
    displayName: player.displayName,
    kind: player.kind,
    score: player.score,
    connected: player.connected,
    choiceLocked: player.choiceLocked,
  }));

  const p1 = state.players.get('PLAYER1');
  const p2 = state.players.get('PLAYER2');
  const currentRound = state.rounds.at(state.currentRound - 1);

  const _revealed =
    currentRound && p1 && p2
      ? {
          player1: getPublicChoice(
            (p1.choice || null) as RpsChoice | null,
            (p2.choice || null) as RpsChoice | null,
            roundExpired,
          ),
          player2: getPublicChoice(
            (p2.choice || null) as RpsChoice | null,
            (p1.choice || null) as RpsChoice | null,
            roundExpired,
          ),
        }
      : null;

  return {
    matchId: state.matchId,
    status: state.status,
    bestOf: state.bestOf,
    currentRound: state.currentRound,
    roundDeadlineMs: state.roundDeadlineMs || null,
    players,
    rounds: state.rounds.map((round) => ({
      roundNumber: round.roundNumber,
      outcome: round.outcome ? (round.outcome as 'PLAYER1' | 'PLAYER2' | 'DRAW') : null,
      revealedChoices:
        round.player1Choice || round.player2Choice
          ? {
              player1: (round.player1Choice || null) as RpsChoice | null,
              player2: (round.player2Choice || null) as RpsChoice | null,
            }
          : null,
    })),
    winnerSlot: state.winnerSlot ? state.winnerSlot : null,
    abortReason: state.abortReason || null,
    botFill: state.botFill,
  };
}
