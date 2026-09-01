import { randomUUID } from 'node:crypto';
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
import { economy, ROUND_TIMEOUT_MS, BEST_OF } from '../config.js';
import { PlayerState, RpsRoomState, RoundState, buildSnapshot } from './rps-state.js';

type JoinOptions = {
  authToken: string;
  userId: string;
  displayName: string;
  slot: 'PLAYER1' | 'PLAYER2';
  kind: 'HUMAN' | 'BOT';
  botFill?: boolean;
  matchId?: string;
};

type RpsRoomMetadata = {
  matchId: string;
  botFill: boolean;
};

export class RpsRoom extends Room<RpsRoomState, RpsRoomMetadata> {
  private roundTimer?: NodeJS.Timeout;
  private random: RandomSource = createRandomSource();
  private finalized = false;

  override maxClients = 2;

  setRandomSource(source: RandomSource) {
    this.random = source;
  }

  override onCreate(options: {
    matchId: string;
    player1: JoinOptions;
    player2: JoinOptions;
    botFill: boolean;
  }) {
    this.setState(new RpsRoomState());
    this.state.matchId = options.matchId;
    this.state.bestOf = BEST_OF;
    this.state.botFill = options.botFill;
    this.state.status = 'WAITING';

    this.setMetadata({ matchId: options.matchId, botFill: options.botFill });
    this.setupPlayer('PLAYER1', options.player1);
    this.setupPlayer('PLAYER2', options.player2);

    this.onMessage('submit_choice', (client, message: { choice?: RpsChoice }) => {
      if (message?.choice) {
        this.handleChoiceFromClient(client, message.choice);
      }
    });

    void this.activateMatch(options);
  }

  private setupPlayer(slot: 'PLAYER1' | 'PLAYER2', options: JoinOptions) {
    const player = new PlayerState();
    player.slot = slot;
    player.userId = options.userId;
    player.displayName = options.displayName;
    player.kind = options.kind;
    player.connected = options.kind === 'BOT' ? true : false;
    this.state.players.set(slot, player);
  }

  private async activateMatch(options: {
    matchId: string;
    player1: JoinOptions;
    player2: JoinOptions;
  }) {
    try {
      await deductEntryFees(prisma, {
        matchId: options.matchId,
        entryFee: economy.rpsEntryFee,
        players: [
          {
            userId: options.player1.userId,
            slot: 1,
            entryFeeKey: `entry:${options.matchId}:${options.player1.userId}`,
          },
          ...(options.player2.kind === 'HUMAN'
            ? [
                {
                  userId: options.player2.userId,
                  slot: 2,
                  entryFeeKey: `entry:${options.matchId}:${options.player2.userId}`,
                },
              ]
            : []),
        ],
      });

      await prisma.match.update({
        where: { id: options.matchId },
        data: { status: 'ACTIVE', roomId: this.roomId },
      });

      this.state.status = 'ACTIVE';
      this.startRound();
    } catch (error) {
      console.error('Failed to activate match', error);
      await this.abortMatch('Failed to deduct entry fees');
    }
  }

  override async onJoin(client: Client, options: JoinOptions) {
    const player = this.state.players.get(options.slot);
    if (!player) {
      throw new Error('Invalid slot');
    }
    player.sessionId = client.sessionId;
    player.connected = true;
    client.send('snapshot', buildSnapshot(this.state, false));

    if (player.kind === 'BOT') {
      this.scheduleBotChoice();
    }
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

    setTimeout(() => {
      if (!bot.choiceLocked && this.state.status === 'ACTIVE') {
        this.submitBotChoice(this.random.pickChoice());
      }
    }, 500 + this.random.nextInt(1500));
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

    const winner = isMatchComplete(
      { PLAYER1: p1.score, PLAYER2: p2.score },
      this.state.bestOf,
    );

    if (winner) {
      void this.finishMatch(winner);
      return;
    }

    this.state.status = 'ACTIVE';
    setTimeout(() => this.startRound(), 1500);
  }

  private async finishMatch(winner: 'PLAYER1' | 'PLAYER2') {
    if (this.finalized) return;
    this.finalized = true;
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
      await finalizeMatchPayout(prisma, {
        matchId: this.state.matchId,
        winnerUserId: winnerPlayer.userId,
        payout: economy.rpsWinnerPayout,
        payoutLedgerKey: `payout:${this.state.matchId}`,
      });
    } else {
      await prisma.match.update({
        where: { id: this.state.matchId },
        data: { status: 'FINISHED', finalizedAt: new Date() },
      });
    }

    this.broadcast('snapshot', buildSnapshot(this.state, true));
    this.broadcast('match_completed', {
      winnerSlot: winner,
      payout: winnerPlayer.kind === 'HUMAN' ? economy.rpsWinnerPayout.toString() : null,
    });

    setTimeout(() => this.disconnect(), 5000);
  }

  private async abortMatch(reason: string) {
    if (this.finalized) return;
    this.finalized = true;
    this.state.status = 'ABORTED';
    this.state.abortReason = reason;

    const players = Array.from(this.state.players.values())
      .filter((p) => p.kind === 'HUMAN' && p.userId)
      .map((p) => ({
        userId: p.userId,
        entryFeeKey: `entry:${this.state.matchId}:${p.userId}`,
      }));

    await refundAbortedMatch(prisma, {
      matchId: this.state.matchId,
      players,
      entryFee: economy.rpsEntryFee,
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

export async function createRpsMatchRecord(options: {
  player1UserId: string;
  player1Name: string;
  player2UserId: string;
  player2Name: string;
  player2Kind: 'HUMAN' | 'BOT';
  botFill: boolean;
}) {
  const game = await prisma.game.findUniqueOrThrow({
    where: { slug: 'rock-paper-scissors' },
  });

  const matchId = randomUUID();

  await prisma.match.create({
    data: {
      id: matchId,
      gameId: game.id,
      status: 'WAITING',
      entryFee: economy.rpsEntryFee,
      winnerPayout: economy.rpsWinnerPayout,
      bestOf: BEST_OF,
      botFill: options.botFill,
      players: {
        create: [
          {
            slot: 1,
            userId: options.player1UserId,
            kind: 'HUMAN',
            displayName: options.player1Name,
            entryFeeKey: `entry:${matchId}:${options.player1UserId}`,
          },
          {
            slot: 2,
            userId: options.player2Kind === 'HUMAN' ? options.player2UserId : null,
            kind: options.player2Kind,
            displayName: options.player2Name,
            entryFeeKey:
              options.player2Kind === 'HUMAN'
                ? `entry:${matchId}:${options.player2UserId}`
                : `entry:${matchId}:bot`,
          },
        ],
      },
    },
  });

  await prisma.matchEvent.create({
    data: {
      matchId,
      type: 'MATCH_CREATED',
      payload: { botFill: options.botFill },
    },
  });

  if (options.botFill) {
    await prisma.matchEvent.create({
      data: {
        matchId,
        type: 'BOT_FILLED',
        payload: {},
      },
    });
  }

  return matchId;
}
