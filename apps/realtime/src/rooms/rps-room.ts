import { authenticateToken } from '../auth.js';
import { assertRoomAuthorized } from '../games/room-authorization.js';
import { Room, Client } from '@colyseus/core';
import {
  createRandomSource,
  isMatchComplete,
  resolveRpsRound,
  type RandomSource,
  type RpsChoice,
} from '@kampi/contracts';
import { prisma } from '@kampi/database';
import { deductEntryFees, finalizeMatchPayout, refundAbortedMatch } from '@kampi/domain';
import { SettlementCoordinator } from '@kampi/game-sdk/server';
import { persistMatchOutcome } from '../games/persist-outcome.js';
import { economy, ROUND_TIMEOUT_MS, BEST_OF } from '../config.js';
import { PlayerState, RpsRoomState, RoundState, buildSnapshot } from './rps-state.js';

type JoinOptions = {
  authToken?: string;
  userId?: string;
  displayName?: string;
  slot?: 'PLAYER1' | 'PLAYER2';
  seat?: 'A' | 'B';
  kind?: 'HUMAN' | 'BOT';
  botFill?: boolean;
  matchId?: string;
  gameId?: string;
};

type SeatPlayer = {
  userId: string;
  displayName: string;
  seat: 'A' | 'B';
  kind: 'HUMAN' | 'BOT';
};

type RpsRoomMetadata = {
  matchId: string;
  botFill: boolean;
};

function seatToLegacySlot(seat: 'A' | 'B'): 'PLAYER1' | 'PLAYER2' {
  return seat === 'A' ? 'PLAYER1' : 'PLAYER2';
}

export class RpsRoom extends Room<RpsRoomState, RpsRoomMetadata> {
  private roundTimer?: NodeJS.Timeout;
  private random: RandomSource = createRandomSource();
  private settlement = new SettlementCoordinator({
    deductEntryFees: (input) => deductEntryFees(prisma, input),
    finalizeMatchPayout: (input) => finalizeMatchPayout(prisma, input),
    refundAbortedMatch: (input) => refundAbortedMatch(prisma, input),
  });

  override maxClients = 2;

  setRandomSource(source: RandomSource) {
    this.random = source;
  }

  override onCreate(options: {
    creationProof?: string;
    matchId: string;
    player1?: JoinOptions;
    player2?: JoinOptions;
    playerA?: SeatPlayer;
    playerB?: SeatPlayer;
    botFill: boolean;
    economy?: { entryFee: string; winnerPayout: string };
  }) {
    assertRoomAuthorized(options);
    const player1: JoinOptions = options.player1 ?? {
      userId: options.playerA?.userId,
      displayName: options.playerA?.displayName,
      slot: 'PLAYER1',
      kind: options.playerA?.kind,
    };
    const player2: JoinOptions = options.player2 ?? {
      userId: options.playerB?.userId,
      displayName: options.playerB?.displayName,
      slot: 'PLAYER2',
      kind: options.playerB?.kind,
    };

    this.setState(new RpsRoomState());
    this.state.matchId = options.matchId;
    this.state.bestOf = BEST_OF;
    this.state.botFill = options.botFill;
    this.state.status = 'WAITING';

    this.setMetadata({ matchId: options.matchId, botFill: options.botFill });
    this.setupPlayer('PLAYER1', player1);
    this.setupPlayer('PLAYER2', player2);

    this.onMessage('submit_choice', (client, message: { choice?: RpsChoice }) => {
      if (message?.choice) {
        this.handleChoiceFromClient(client, message.choice);
      }
    });

    void this.activateMatch({
      matchId: options.matchId,
      player1,
      player2,
      entryFee: options.economy?.entryFee ? BigInt(options.economy.entryFee) : economy.rpsEntryFee,
      winnerPayout: options.economy?.winnerPayout
        ? BigInt(options.economy.winnerPayout)
        : economy.rpsWinnerPayout,
    });
  }

  private setupPlayer(slot: 'PLAYER1' | 'PLAYER2', options: JoinOptions) {
    const player = new PlayerState();
    player.slot = slot;
    player.userId = options.userId ?? '';
    player.displayName = options.displayName ?? (slot === 'PLAYER1' ? 'Player 1' : 'Player 2');
    player.kind = options.kind ?? 'HUMAN';
    player.connected = options.kind === 'BOT' ? true : false;
    this.state.players.set(slot, player);
  }

  private async activateMatch(options: {
    matchId: string;
    player1: JoinOptions;
    player2: JoinOptions;
    entryFee: bigint;
    winnerPayout: bigint;
  }) {
    try {
      const humans = [options.player1, options.player2].filter(
        (p) => p.kind === 'HUMAN' && p.userId,
      );
      await this.settlement.deductEntries({
        matchId: options.matchId,
        entryFee: options.entryFee,
        players: humans.map((p, index) => ({
          userId: p.userId!,
          slot: p.slot === 'PLAYER2' ? 2 : index + 1,
          entryFeeKey: `entry:${options.matchId}:${p.userId}`,
        })),
      });

      await prisma.match.update({
        where: { id: options.matchId },
        data: { status: 'ACTIVE', roomId: this.roomId },
      });

      this.state.status = 'ACTIVE';
      this.startRound();
    } catch (error) {
      console.error('Failed to activate match', error);
      await this.abortMatch('Failed to deduct entry fees', options.entryFee);
    }
  }

  override async onJoin(client: Client, options: JoinOptions) {
    const slot =
      options.slot ??
      (options.seat ? seatToLegacySlot(options.seat) : undefined) ??
      (Array.from(this.state.players.values()).find((p) => p.userId && !p.sessionId)?.slot as
        'PLAYER1' | 'PLAYER2' | undefined);

    if (!slot) {
      throw new Error('Invalid slot');
    }
    const player = this.state.players.get(slot);
    if (!player) {
      throw new Error('Invalid slot');
    }
    const auth = options.authToken ? await authenticateToken(options.authToken) : null;
    if (!auth || player.kind !== 'HUMAN' || player.userId !== auth.userId || player.sessionId) {
      throw new Error('Unauthorized seat');
    }
    player.sessionId = client.sessionId;
    player.connected = true;
    client.send('snapshot', buildSnapshot(this.state, false));
    client.send('seat_assigned', { seat: slot === 'PLAYER1' ? 'A' : 'B', slot });
  }

  override async onLeave(client: Client, consented: boolean) {
    const player = Array.from(this.state.players.values()).find(
      (p) => p.sessionId === client.sessionId,
    );
    if (!player || player.kind === 'BOT') return;

    player.connected = false;

    if (this.state.status === 'FINISHED' || this.state.status === 'ABORTED') return;

    const graceSeconds = Math.ceil(economy.reconnectGraceMs / 1000);

    try {
      if (consented) throw new Error('consented leave');
      await this.allowReconnection(client, graceSeconds);
      player.connected = true;
      client.send('snapshot', buildSnapshot(this.state, false));
      await prisma.matchEvent.create({
        data: {
          matchId: this.state.matchId,
          type: 'RECONNECT',
          payload: { userId: player.userId },
        },
      });
    } catch {
      player.connected = false;
      if (this.state.status === 'ACTIVE') {
        await this.abortMatch('Player disconnected beyond grace period');
      }
    }
  }

  private handleChoiceFromClient(client: Client, choice: RpsChoice) {
    const player = Array.from(this.state.players.values()).find(
      (p) => p.sessionId === client.sessionId,
    );
    if (!player || player.kind === 'BOT') {
      client.send('error', { code: 'INVALID_COMMAND', message: 'Not allowed' });
      return;
    }

    this.handleChoice(player.slot, choice);
  }

  /** Bot uses the same path as human players */
  submitBotChoice(choice: RpsChoice) {
    this.handleChoice('PLAYER2', choice);
  }

  private handleChoice(slot: 'PLAYER1' | 'PLAYER2', choice?: RpsChoice) {
    if (this.state.status !== 'ACTIVE') return;
    if (!choice || !['ROCK', 'PAPER', 'SCISSORS'].includes(choice)) return;

    const player = this.state.players.get(slot);
    if (!player || player.choiceLocked) return;

    player.choice = choice;
    player.choiceLocked = true;

    void prisma.matchEvent.create({
      data: {
        matchId: this.state.matchId,
        type: 'CHOICE_SUBMITTED',
        payload: { slot, kind: player.kind },
      },
    });

    const p1 = this.state.players.get('PLAYER1');
    const p2 = this.state.players.get('PLAYER2');
    if (p1?.choiceLocked && p2?.choiceLocked) {
      this.resolveCurrentRound(true);
    }
  }

  private startRound() {
    if (this.roundTimer) clearTimeout(this.roundTimer);

    this.state.currentRound += 1;
    const round = new RoundState();
    round.roundNumber = this.state.currentRound;
    this.state.rounds.push(round);

    for (const player of this.state.players.values()) {
      player.choice = '';
      player.choiceLocked = false;
    }

    this.state.roundDeadlineMs = Date.now() + ROUND_TIMEOUT_MS;

    void prisma.matchEvent.create({
      data: {
        matchId: this.state.matchId,
        type: 'ROUND_STARTED',
        payload: { roundNumber: this.state.currentRound },
      },
    });

    this.broadcast('snapshot', buildSnapshot(this.state, false));
    this.scheduleBotChoice();

    this.roundTimer = setTimeout(() => {
      this.resolveCurrentRound(false);
    }, ROUND_TIMEOUT_MS);
  }

  private scheduleBotChoice() {
    const bot = this.state.players.get('PLAYER2');
    if (!bot || bot.kind !== 'BOT' || bot.choiceLocked || this.state.status !== 'ACTIVE') return;

    setTimeout(
      () => {
        if (!bot.choiceLocked && this.state.status === 'ACTIVE') {
          this.submitBotChoice(this.random.pickChoice());
        }
      },
      500 + this.random.nextInt(1500),
    );
  }

  private resolveCurrentRound(bothLocked: boolean) {
    if (this.state.status !== 'ACTIVE') return;
    if (this.roundTimer) clearTimeout(this.roundTimer);

    this.state.status = 'RESOLVING';
    const p1 = this.state.players.get('PLAYER1');
    const p2 = this.state.players.get('PLAYER2');
    const round = this.state.rounds.at(this.state.currentRound - 1);
    if (!p1 || !p2 || !round) return;

    const c1 = p1.choiceLocked ? (p1.choice as RpsChoice) : null;
    const c2 = p2.choiceLocked ? (p2.choice as RpsChoice) : null;

    let outcome: 'PLAYER1' | 'PLAYER2' | 'DRAW' = 'DRAW';
    if (c1 && c2) {
      outcome = resolveRpsRound(c1, c2);
    } else if (c1 && !c2) {
      outcome = 'PLAYER1';
    } else if (!c1 && c2) {
      outcome = 'PLAYER2';
    }

    round.outcome = outcome;
    round.player1Choice = c1 ?? '';
    round.player2Choice = c2 ?? '';

    if (outcome === 'PLAYER1') p1.score += 1;
    if (outcome === 'PLAYER2') p2.score += 1;

    void prisma.matchEvent.create({
      data: {
        matchId: this.state.matchId,
        type: 'ROUND_RESOLVED',
        payload: {
          roundNumber: round.roundNumber,
          outcome,
          bothLocked,
          revealed: { player1: c1, player2: c2 },
        },
      },
    });

    this.broadcast('snapshot', buildSnapshot(this.state, true));

    const winner = isMatchComplete({ PLAYER1: p1.score, PLAYER2: p2.score }, this.state.bestOf);

    if (winner) {
      void this.finishMatch(winner);
      return;
    }

    this.state.status = 'ACTIVE';
    setTimeout(() => this.startRound(), 1500);
  }

  private async finishMatch(winner: 'PLAYER1' | 'PLAYER2') {
    if (this.settlement.isFinalized) return;
    this.state.status = 'FINISHED';
    this.state.winnerSlot = winner;

    const winnerPlayer = this.state.players.get(winner);
    if (!winnerPlayer) return;

    await prisma.matchEvent.create({
      data: {
        matchId: this.state.matchId,
        type: 'MATCH_FINISHED',
        payload: { winnerSlot: winner },
      },
    });

    if (winnerPlayer.kind === 'HUMAN' && winnerPlayer.userId) {
      await this.settlement.payWinner({
        matchId: this.state.matchId,
        winnerUserId: winnerPlayer.userId,
        payout: economy.rpsWinnerPayout,
        payoutLedgerKey: `payout:${this.state.matchId}`,
      });
    } else {
      this.settlement.markFinalized();
      await prisma.match.update({
        where: { id: this.state.matchId },
        data: { status: 'FINISHED', finalizedAt: new Date() },
      });
    }

    const p1 = this.state.players.get('PLAYER1');
    const p2 = this.state.players.get('PLAYER2');
    await persistMatchOutcome({
      matchId: this.state.matchId,
      winnerSlot: winner === 'PLAYER1' ? 1 : 2,
      winnerUserId:
        winnerPlayer.kind === 'HUMAN' && winnerPlayer.userId ? winnerPlayer.userId : null,
      scores: [
        { slot: 1, score: p1?.score ?? 0 },
        { slot: 2, score: p2?.score ?? 0 },
      ],
    });

    this.broadcast('snapshot', buildSnapshot(this.state, true));
    this.broadcast('match_completed', {
      winnerSlot: winner,
      payout: winnerPlayer.kind === 'HUMAN' ? economy.rpsWinnerPayout.toString() : null,
    });

    setTimeout(() => this.disconnect(), 5000);
  }

  private async abortMatch(reason: string, entryFee: bigint = economy.rpsEntryFee) {
    if (this.settlement.isFinalized) return;
    this.state.status = 'ABORTED';
    this.state.abortReason = reason;

    const players = Array.from(this.state.players.values())
      .filter((p) => p.kind === 'HUMAN' && p.userId)
      .map((p) => ({
        userId: p.userId,
        entryFeeKey: `entry:${this.state.matchId}:${p.userId}`,
      }));

    await this.settlement.abortRefund({
      matchId: this.state.matchId,
      players,
      entryFee,
      abortRefundKey: `abort:${this.state.matchId}`,
    });

    await prisma.matchEvent.create({
      data: {
        matchId: this.state.matchId,
        type: 'MATCH_ABORTED',
        payload: { reason },
      },
    });

    this.broadcast('snapshot', buildSnapshot(this.state, true));
    setTimeout(() => this.disconnect(), 3000);
  }
}
