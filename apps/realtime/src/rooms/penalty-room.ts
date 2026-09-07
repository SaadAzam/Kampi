import { assertRoomAuthorized } from '../games/room-authorization.js';
import { randomUUID } from 'node:crypto';
import { Room, Client } from '@colyseus/core';
import { prisma } from '@kampi/database';
import { deductEntryFees, finalizeMatchPayout, refundAbortedMatch } from '@kampi/domain';
import { createRandomProvider, type RandomProvider, type Seat } from '@kampi/game-sdk/common';
import { CommandGuard, DeadlineScheduler, SettlementCoordinator } from '@kampi/game-sdk/server';
import {
  PENALTY_GAME_ID,
  PenaltyGameConfigSchema,
  ShootCommandSchema,
  actionToDirection,
  applyTurnScore,
  canSubmitRole,
  chooseFirstKicker,
  decideMatchProgress,
  oppositeSeat,
  pickBotAction,
  resolvePenaltyTurn,
  rolesForSequence,
  type Direction,
  type FinishReason,
  type PenaltyGameConfig,
  type PenaltyPhase,
  type TimeoutReason,
  type TurnOutcome,
} from '@kampi/game-penalty';
import { authenticateToken } from '../auth.js';
import { persistMatchOutcome } from '../games/persist-outcome.js';
import { economy } from '../config.js';

type SeatPlayer = {
  userId: string;
  displayName: string;
  seat: Seat;
  kind: 'HUMAN' | 'BOT';
};

type PublicPlayer = {
  seat: Seat;
  displayName: string;
  kind: 'HUMAN' | 'BOT';
  score: number;
  connected: boolean;
  isBot: boolean;
};

type RevealedTurn = {
  turnId: string;
  sequence: number;
  kickerSeat: Seat;
  goalkeeperSeat: Seat;
  shot: Direction | null;
  dive: Direction | null;
  outcome: TurnOutcome;
  timeoutReason: TimeoutReason;
  resultingScore: Record<Seat, number>;
};

type ActiveTurnPublic = {
  turnId: string;
  sequence: number;
  kickerSeat: Seat;
  goalkeeperSeat: Seat;
  deadlineAt: number;
  kickerLocked: boolean;
  goalkeeperLocked: boolean;
};

type PenaltySnapshot = {
  matchId: string;
  gameId: string;
  gameVersion: string;
  protocolVersion: string;
  phase: PenaltyPhase;
  serverNow: number;
  players: PublicPlayer[];
  regulationKicksPerPlayer: number;
  completedRegulationKicksBySeat: Record<Seat, number>;
  suddenDeathPair: number;
  inSuddenDeath: boolean;
  activeTurn: ActiveTurnPublic | null;
  revealedHistory: RevealedTurn[];
  winnerSeat: Seat | null;
  finishReason: FinishReason | null;
  abortReason: string | null;
  yourSeat?: Seat;
};

export class PenaltyDuelRoom extends Room {
  private config: PenaltyGameConfig = PenaltyGameConfigSchema.parse({});
  private phase: PenaltyPhase = 'WAITING_FOR_PLAYERS';
  private players = new Map<
    Seat,
    {
      userId: string;
      displayName: string;
      kind: 'HUMAN' | 'BOT';
      score: number;
      connected: boolean;
      sessionId: string;
    }
  >();
  private firstKicker: Seat = 'A';
  private sequence = 0;
  private kicksTaken: Record<Seat, number> = { A: 0, B: 0 };
  private suddenDeathPair = 0;
  private inSuddenDeath = false;
  private activeTurnId: string | null = null;
  private activeDeadlineAt = 0;
  private pending: { shot: Direction | null; dive: Direction | null } = {
    shot: null,
    dive: null,
  };
  private revealedHistory: RevealedTurn[] = [];
  private winnerSeat: Seat | null = null;
  private finishReason: FinishReason | null = null;
  private abortReason: string | null = null;
  private matchId = '';
  private entryFee = 500n;
  private winnerPayout = 950n;
  private random: RandomProvider = createRandomProvider();
  private guards = new Map<string, CommandGuard>();
  private deadlines = new DeadlineScheduler();
  private turnDeadline?: { clear(): void };
  private settlement = new SettlementCoordinator({
    deductEntryFees: (input) => deductEntryFees(prisma, input),
    finalizeMatchPayout: (input) => finalizeMatchPayout(prisma, input),
    refundAbortedMatch: (input) => refundAbortedMatch(prisma, input),
  });
  private botFill = false;
  private terminalPublished = false;

  override maxClients = 2;

  setRandomProvider(random: RandomProvider) {
    this.random = random;
  }

  override onCreate(options: {
    creationProof?: string;
    matchId: string;
    botFill: boolean;
    gameId: string;
    playerA: SeatPlayer;
    playerB: SeatPlayer;
    economy: { entryFee: string; winnerPayout: string };
    versionConfig: unknown;
  }) {
    assertRoomAuthorized(options);
    this.matchId = options.matchId;
    this.botFill = options.botFill;
    this.config = PenaltyGameConfigSchema.parse(options.versionConfig ?? {});
    this.entryFee = BigInt(options.economy.entryFee);
    this.winnerPayout = BigInt(options.economy.winnerPayout);

    this.setupSeat('A', options.playerA);
    this.setupSeat('B', options.playerB);

    this.onMessage('submit_action', (client, raw) => {
      void this.handleSubmitAction(client, raw);
    });

    this.onMessage('request_snapshot', (client) => {
      const seat = [...this.players.entries()].find(
        ([, p]) => p.sessionId === client.sessionId,
      )?.[0];
      if (seat) client.send('snapshot', this.buildSnapshot(seat));
    });

    this.autoDispose = false;
    this.deadlines.schedule(this.config.reconnectGraceMs, () => {
      if (this.phase === 'WAITING_FOR_PLAYERS') void this.abort('Players did not connect in time');
    });
  }

  private setupSeat(seat: Seat, player: SeatPlayer) {
    this.players.set(seat, {
      userId: player.userId,
      displayName: player.displayName,
      kind: player.kind,
      score: 0,
      connected: player.kind === 'BOT',
      sessionId: '',
    });
  }

  private async startMatch() {
    if (this.phase !== 'WAITING_FOR_PLAYERS') return;
    this.phase = 'STARTING';
    this.deadlines.clearAll();
    try {
      const humans = [...this.players.entries()].filter(([, p]) => p.kind === 'HUMAN');
      await this.settlement.deductEntries({
        matchId: this.matchId,
        entryFee: this.entryFee,
        players: humans.map(([seat, p]) => ({
          userId: p.userId,
          slot: seat === 'A' ? 1 : 2,
          entryFeeKey: `entry:${this.matchId}:${p.userId}`,
        })),
      });
      await prisma.match.update({
        where: { id: this.matchId },
        data: { status: 'ACTIVE', roomId: this.roomId },
      });
      this.firstKicker = chooseFirstKicker(this.random);
      await prisma.matchEvent.create({
        data: {
          matchId: this.matchId,
          type: 'ROUND_STARTED',
          payload: { firstKicker: this.firstKicker, gameId: PENALTY_GAME_ID },
        },
      });
      this.beginNextTurn();
    } catch (error) {
      console.error('Penalty match start failed', error);
      await this.abort('Failed to deduct entry fees');
    }
  }

  override async onJoin(
    client: Client,
    options: {
      authToken?: string;
      seat?: Seat;
      matchId?: string;
      gameId?: string;
    },
  ) {
    if (!options.authToken) throw new Error('Unauthorized');
    const auth = await authenticateToken(options.authToken);
    if (!auth) throw new Error('Unauthorized');

    const seat =
      options.seat ??
      ([...this.players.entries()].find(
        ([, p]) => p.userId === auth.userId && p.kind === 'HUMAN',
      )?.[0] as Seat | undefined);

    if (!seat) throw new Error('No seat');
    const player = this.players.get(seat);
    if (!player || player.kind !== 'HUMAN' || player.userId !== auth.userId || player.sessionId) {
      throw new Error('Seat reserved for another player');
    }

    player.sessionId = client.sessionId;
    player.connected = true;
    this.guards.set(client.sessionId, new CommandGuard());
    client.send('snapshot', this.buildSnapshot(seat));
    client.send('seat_assigned', { seat });
    if ([...this.players.values()].every((p) => p.connected)) await this.startMatch();
    this.broadcastSnapshot();
  }

  override async onLeave(client: Client, consented: boolean) {
    const entry = [...this.players.entries()].find(([, p]) => p.sessionId === client.sessionId);
    if (!entry) return;
    const [seat, player] = entry;
    if (player.kind === 'BOT') return;
    player.connected = false;
    this.broadcastSnapshot();

    if (this.phase === 'FINISHED' || this.phase === 'ABORTED') return;

    const graceSeconds = Math.ceil(
      (this.config.reconnectGraceMs || economy.reconnectGraceMs) / 1000,
    );

    try {
      if (consented) throw new Error('consented leave');
      // Never replace human with bot mid-match
      const restored = await this.allowReconnection(client, graceSeconds);
      player.sessionId = restored.sessionId;
      player.connected = true;
      this.guards.set(restored.sessionId, new CommandGuard());
      this.broadcastSnapshot();
      restored.send('snapshot', this.buildSnapshot(seat));
      await prisma.matchEvent.create({
        data: {
          matchId: this.matchId,
          type: 'RECONNECT',
          payload: { seat, userId: player.userId },
        },
      });
    } catch {
      if (this.isTerminal()) return;
      player.connected = false;
      if (this.phase === 'WAITING_FOR_PLAYERS') {
        await this.abort('Player left before the match started');
        return;
      }
      const opponent = this.players.get(oppositeSeat(seat));
      if (opponent?.connected) {
        await this.finishForfeit(oppositeSeat(seat));
      } else if (this.sequence === 0 && this.revealedHistory.length === 0) {
        await this.abort('Both players unavailable before meaningful play');
      } else {
        await this.abort('Both players disconnected');
      }
    }
  }

  private beginNextTurn() {
    this.deadlines.clearAll();
    this.sequence += 1;
    const roles = rolesForSequence(this.firstKicker, this.sequence);
    this.activeTurnId = randomUUID();
    this.pending = { shot: null, dive: null };
    this.activeDeadlineAt = Date.now() + this.config.decisionTimeMs;
    this.phase = 'AWAITING_ACTIONS';

    this.broadcastSnapshot();
    this.scheduleBotIfNeeded(roles.kickerSeat, roles.goalkeeperSeat);

    const turnId = this.activeTurnId;
    this.turnDeadline = this.deadlines.schedule(this.config.decisionTimeMs, () => {
      if (this.activeTurnId !== turnId || this.phase !== 'AWAITING_ACTIONS') return;
      this.resolveTurn(true);
    });
  }

  private scheduleBotIfNeeded(kickerSeat: Seat, goalkeeperSeat: Seat) {
    for (const seat of [kickerSeat, goalkeeperSeat] as Seat[]) {
      const player = this.players.get(seat);
      if (!player || player.kind !== 'BOT') continue;
      const role = seat === kickerSeat ? 'KICKER' : 'GOALKEEPER';
      // Pick independently before human action is known
      const action = pickBotAction(role, this.random);
      const delay = 400 + this.random.nextInt(900);
      this.deadlines.schedule(delay, () => {
        if (this.phase !== 'AWAITING_ACTIONS' || !this.activeTurnId) return;
        this.applyAction(seat, role, actionToDirection(action).direction, randomUUID());
      });
    }
  }

  private async handleSubmitAction(client: Client, raw: unknown) {
    const guard = this.guards.get(client.sessionId) ?? new CommandGuard();
    this.guards.set(client.sessionId, guard);
    try {
      guard.assertRateLimit(Date.now());
      const command = ShootCommandSchema.parse({
        type: 'submit_action',
        ...(typeof raw === 'object' && raw !== null ? raw : {}),
      });
      if (
        command.protocolVersion !== '1.0.0' ||
        (command.matchId && command.matchId !== this.matchId)
      ) {
        client.send('error', { code: 'INVALID_COMMAND', message: 'Wrong protocol or match' });
        return;
      }
      if (command.gameId !== PENALTY_GAME_ID) {
        client.send('error', { code: 'UNSUPPORTED_GAME', message: 'Wrong game' });
        return;
      }
      if (this.phase !== 'AWAITING_ACTIONS') {
        client.send('error', { code: 'WRONG_PHASE', message: 'Not accepting actions' });
        return;
      }
      if (!this.activeTurnId || command.turnId !== this.activeTurnId) {
        client.send('error', { code: 'WRONG_TURN', message: 'Stale turn' });
        return;
      }
      if (Date.now() >= this.activeDeadlineAt) {
        this.resolveTurn(true);
        client.send('error', { code: 'TURN_EXPIRED', message: 'The turn has ended' });
        return;
      }
      if (guard.checkIdempotency(command.commandId) === 'duplicate') {
        client.send('private_ack', { commandId: command.commandId, duplicate: true });
        return;
      }

      const entry = [...this.players.entries()].find(([, p]) => p.sessionId === client.sessionId);
      if (!entry) {
        client.send('error', { code: 'UNAUTHORIZED', message: 'Not seated' });
        return;
      }
      const [seat] = entry;
      const roles = rolesForSequence(this.firstKicker, this.sequence);
      const role = seat === roles.kickerSeat ? 'KICKER' : 'GOALKEEPER';
      if (seat !== roles.kickerSeat && seat !== roles.goalkeeperSeat) {
        client.send('error', { code: 'WRONG_ROLE', message: 'Not in this turn' });
        return;
      }
      if (!canSubmitRole(role, command.action)) {
        client.send('error', { code: 'WRONG_ROLE', message: 'Action not allowed for role' });
        return;
      }

      const { direction } = actionToDirection(command.action);
      this.applyAction(seat, role, direction, command.commandId);
      client.send('private_ack', {
        commandId: command.commandId,
        turnId: this.activeTurnId,
        locked: true,
      });
    } catch (error) {
      client.send('error', {
        code: 'INVALID_COMMAND',
        message: error instanceof Error ? error.message : 'Invalid command',
      });
    }
  }

  private applyAction(
    seat: Seat,
    role: 'KICKER' | 'GOALKEEPER',
    direction: Direction,
    commandId: string,
  ) {
    if (this.phase !== 'AWAITING_ACTIONS') return;
    if (Date.now() >= this.activeDeadlineAt) {
      this.resolveTurn(true);
      return;
    }
    if (role === 'KICKER') {
      if (this.pending.shot) return;
      this.pending.shot = direction;
    } else {
      if (this.pending.dive) return;
      this.pending.dive = direction;
    }

    void prisma.matchEvent
      .create({
        data: {
          matchId: this.matchId,
          type: 'CHOICE_SUBMITTED',
          payload: { seat, role, commandId, turnId: this.activeTurnId },
        },
      })
      .catch((error) => console.error('Penalty audit failed', error));

    this.broadcastSnapshot();

    if (this.pending.shot && this.pending.dive) {
      this.resolveTurn(false);
    }
  }

  private resolveTurn(fromTimeout: boolean) {
    if (this.phase !== 'AWAITING_ACTIONS' || !this.activeTurnId) return;
    this.turnDeadline?.clear();
    this.phase = 'REVEALING_RESULT';

    const roles = rolesForSequence(this.firstKicker, this.sequence);
    const result = resolvePenaltyTurn({
      shot: this.pending.shot,
      dive: this.pending.dive,
      kickerTimedOut: fromTimeout && !this.pending.shot,
      goalkeeperTimedOut: fromTimeout && !this.pending.dive,
    });

    const scores = applyTurnScore(
      {
        A: this.players.get('A')?.score ?? 0,
        B: this.players.get('B')?.score ?? 0,
      },
      roles.kickerSeat,
      result.outcome,
    );
    for (const seat of ['A', 'B'] as Seat[]) {
      const player = this.players.get(seat);
      if (player) player.score = scores[seat];
    }
    this.kicksTaken[roles.kickerSeat] += 1;

    const revealed: RevealedTurn = {
      turnId: this.activeTurnId,
      sequence: this.sequence,
      kickerSeat: roles.kickerSeat,
      goalkeeperSeat: roles.goalkeeperSeat,
      shot: result.shot,
      dive: result.dive,
      outcome: result.outcome,
      timeoutReason: result.timeoutReason,
      resultingScore: scores,
    };
    this.revealedHistory.push(revealed);

    void prisma.matchEvent
      .create({
        data: {
          matchId: this.matchId,
          type: 'ROUND_RESOLVED',
          payload: revealed,
        },
      })
      .catch((error) => console.error('Penalty audit failed', error));

    this.broadcast('turn_revealed', revealed);
    this.broadcastSnapshot();

    const decision = decideMatchProgress({
      regulationKicksPerPlayer: this.config.regulationKicksPerPlayer,
      kicksTaken: { ...this.kicksTaken },
      scores,
      suddenDeathPair: this.suddenDeathPair,
      inSuddenDeath: this.inSuddenDeath,
    });

    this.deadlines.schedule(this.config.revealDurationMs, () => {
      if (this.phase !== 'REVEALING_RESULT') return;
      if (decision.type === 'FINISHED') {
        void this.finish(decision.winnerSeat, decision.reason);
        return;
      }
      if (decision.type === 'ENTER_SUDDEN_DEATH') {
        this.inSuddenDeath = true;
        this.suddenDeathPair = 1;
      } else if (decision.type === 'CONTINUE_SUDDEN_DEATH') {
        const target = this.config.regulationKicksPerPlayer + this.suddenDeathPair;
        if (this.kicksTaken.A >= target && this.kicksTaken.B >= target) {
          this.suddenDeathPair += 1;
        }
      }
      this.phase = 'NEXT_TURN';
      this.beginNextTurn();
    });
  }

  private isTerminal() {
    return this.phase === 'FINISHED' || this.phase === 'ABORTED';
  }

  private async finish(winnerSeat: Seat, reason: FinishReason) {
    if (this.isTerminal()) return;
    this.phase = 'FINISHED';
    this.winnerSeat = winnerSeat;
    this.finishReason = reason;
    this.deadlines.clearAll();

    const complete = async (): Promise<void> => {
      try {
        const winner = this.players.get(winnerSeat);
        await prisma.matchEvent.create({
          data: {
            matchId: this.matchId,
            type: 'MATCH_FINISHED',
            payload: {
              winnerSeat,
              reason,
              scores: { A: this.players.get('A')?.score, B: this.players.get('B')?.score },
            },
          },
        });

        if (winner?.kind === 'HUMAN' && winner.userId) {
          await this.settlement.payWinner({
            matchId: this.matchId,
            winnerUserId: winner.userId,
            payout: this.winnerPayout,
            payoutLedgerKey: `payout:${this.matchId}`,
          });
        } else {
          await prisma.match.update({
            where: { id: this.matchId },
            data: { status: 'FINISHED', finalizedAt: new Date() },
          });
          this.settlement.markFinalized();
        }

        const playerA = this.players.get('A');
        const playerB = this.players.get('B');
        await persistMatchOutcome({
          matchId: this.matchId,
          winnerSlot: winnerSeat === 'A' ? 1 : 2,
          winnerUserId: winner?.kind === 'HUMAN' && winner.userId ? winner.userId : null,
          scores: [
            { slot: 1, score: playerA?.score ?? 0 },
            { slot: 2, score: playerB?.score ?? 0 },
          ],
        });

        this.terminalPublished = true;
        this.broadcastSnapshot();
        this.broadcast('match_completed', {
          winnerSeat,
          finishReason: reason,
          payout: winner?.kind === 'HUMAN' ? this.winnerPayout.toString() : null,
        });
        this.deadlines.schedule(5000, () => {
          void this.disconnect();
        });
      } catch (error) {
        console.error('Penalty settlement failed; retrying', error);
        this.deadlines.schedule(2000, () => {
          void complete();
        });
      }
    };
    await complete();
  }

  private async finishForfeit(winnerSeat: Seat) {
    await this.finish(winnerSeat, 'FORFEIT');
  }

  private async abort(reason: string) {
    if (this.isTerminal()) return;
    this.phase = 'ABORTED';
    this.abortReason = reason;
    this.finishReason = 'ABORT';
    this.deadlines.clearAll();

    const players = [...this.players.values()]
      .filter((p) => p.kind === 'HUMAN' && p.userId)
      .map((p) => ({
        userId: p.userId,
        entryFeeKey: `entry:${this.matchId}:${p.userId}`,
      }));

    const complete = async (): Promise<void> => {
      try {
        await this.settlement.abortRefund({
          matchId: this.matchId,
          players,
          entryFee: this.entryFee,
          abortRefundKey: `abort:${this.matchId}`,
        });

        await prisma.matchEvent.create({
          data: {
            matchId: this.matchId,
            type: 'MATCH_ABORTED',
            payload: { reason },
          },
        });

        this.terminalPublished = true;
        this.broadcastSnapshot();
        this.deadlines.schedule(3000, () => {
          void this.disconnect();
        });
      } catch (error) {
        console.error('Penalty refund failed; retrying', error);
        this.deadlines.schedule(2000, () => {
          void complete();
        });
      }
    };
    await complete();
  }

  private buildSnapshot(yourSeat?: Seat): PenaltySnapshot {
    const roles =
      this.activeTurnId && this.sequence > 0
        ? rolesForSequence(this.firstKicker, this.sequence)
        : null;

    return {
      matchId: this.matchId,
      gameId: PENALTY_GAME_ID,
      gameVersion: '1.0.0',
      protocolVersion: '1.0.0',
      phase: this.isTerminal() && !this.terminalPublished ? 'NEXT_TURN' : this.phase,
      serverNow: Date.now(),
      players: [...this.players.entries()].map(([seat, p]) => ({
        seat,
        displayName: p.displayName,
        kind: p.kind,
        score: p.score,
        connected: p.connected,
        isBot: p.kind === 'BOT',
      })),
      regulationKicksPerPlayer: this.config.regulationKicksPerPlayer,
      completedRegulationKicksBySeat: { ...this.kicksTaken },
      suddenDeathPair: this.suddenDeathPair,
      inSuddenDeath: this.inSuddenDeath,
      activeTurn:
        roles && this.activeTurnId && this.phase === 'AWAITING_ACTIONS'
          ? {
              turnId: this.activeTurnId,
              sequence: this.sequence,
              kickerSeat: roles.kickerSeat,
              goalkeeperSeat: roles.goalkeeperSeat,
              deadlineAt: this.activeDeadlineAt,
              kickerLocked: this.pending.shot !== null,
              goalkeeperLocked: this.pending.dive !== null,
            }
          : null,
      revealedHistory: this.revealedHistory,
      winnerSeat: this.winnerSeat,
      finishReason: this.finishReason,
      abortReason: this.abortReason,
      yourSeat,
    };
  }

  private broadcastSnapshot() {
    for (const client of this.clients) {
      const seat = [...this.players.entries()].find(
        ([, p]) => p.sessionId === client.sessionId,
      )?.[0];
      client.send('snapshot', this.buildSnapshot(seat));
    }
  }

  override onDispose() {
    this.deadlines.clearAll();
  }
}
