import { Room, Client, matchMaker } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { prisma } from '@kampi/database';
import { authenticateToken } from '../auth.js';
import { economy } from '../config.js';
import { createRpsMatchRecord } from './rps-room.js';

type QueueEntry = {
  ticketId: string;
  userId: string;
  displayName: string;
  client: Client;
  joinedAt: number;
};

export class LobbyRoom extends Room {
  private queue: QueueEntry[] = [];
  private botTimers = new Map<string, NodeJS.Timeout>();

  override onCreate() {
    this.setPatchRate(1000);
    this.onMessage('leave_queue', (client) => {
      client.leave();
    });
  }

  override async onJoin(client: Client, options: { authToken?: string }) {
    const token = options.authToken;
    if (!token) {
      client.send('error', { code: 'UNAUTHORIZED', message: 'Missing auth token' });
      client.leave();
      return;
    }

    const player = await authenticateToken(token);
    if (!player) {
      client.send('error', { code: 'UNAUTHORIZED', message: 'Invalid auth token' });
      client.leave();
      return;
    }

    const existing = this.queue.find((entry) => entry.userId === player.userId);
    if (existing) {
      client.send('error', { code: 'ALREADY_QUEUED', message: 'Already in queue' });
      client.leave();
      return;
    }

    const ticketId = randomUUID();
    const entry: QueueEntry = {
      ticketId,
      userId: player.userId,
      displayName: player.displayName,
      client,
      joinedAt: Date.now(),
    };

    this.queue.push(entry);

    const game = await prisma.game.findUniqueOrThrow({
      where: { slug: 'rock-paper-scissors' },
    });

    await prisma.matchmakingTicket.create({
      data: {
        id: ticketId,
        userId: player.userId,
        gameId: game.id,
        status: 'QUEUED',
      },
    });

    client.send('queue_joined', {
      ticketId,
      position: this.queue.length - 1,
    });

    this.tryMatchRealPlayers();

    const timer = setTimeout(() => {
      void this.fillWithBot(entry);
    }, economy.botFillAfterMs);
    this.botTimers.set(ticketId, timer);
  }

  override async onLeave(client: Client) {
    const index = this.queue.findIndex((entry) => entry.client.sessionId === client.sessionId);
    if (index === -1) return;

    const [removed] = this.queue.splice(index, 1);
    if (!removed) return;

    const timer = this.botTimers.get(removed.ticketId);
    if (timer) {
      clearTimeout(timer);
      this.botTimers.delete(removed.ticketId);
    }

    await prisma.matchmakingTicket.update({
      where: { id: removed.ticketId },
      data: { status: 'CANCELLED' },
    });

    client.send('queue_left', {});
  }

  private tryMatchRealPlayers() {
    while (this.queue.length >= 2) {
      const first = this.queue.shift();
      const second = this.queue.shift();
      if (!first || !second) break;

      this.clearBotTimer(first.ticketId);
      this.clearBotTimer(second.ticketId);

      void this.createMatch(first, second, false);
    }
  }

  private clearBotTimer(ticketId: string) {
    const timer = this.botTimers.get(ticketId);
    if (timer) {
      clearTimeout(timer);
      this.botTimers.delete(ticketId);
    }
  }

  private async fillWithBot(entry: QueueEntry) {
    if (!this.queue.some((q) => q.ticketId === entry.ticketId)) return;
    this.queue = this.queue.filter((q) => q.ticketId !== entry.ticketId);
    this.clearBotTimer(entry.ticketId);

    const botEntry: QueueEntry = {
      ticketId: randomUUID(),
      userId: 'bot',
      displayName: 'Bot',
      client: entry.client,
      joinedAt: Date.now(),
    };

    void this.createMatch(entry, botEntry, true);
  }

  private async createMatch(player1: QueueEntry, player2: QueueEntry, botFill: boolean) {
    const isBot = botFill || player2.userId === 'bot';
    const matchId = await createRpsMatchRecord({
      player1UserId: player1.userId,
      player1Name: player1.displayName,
      player2UserId: isBot ? 'bot' : player2.userId,
      player2Name: isBot ? 'Bot Opponent' : player2.displayName,
      player2Kind: isBot ? 'BOT' : 'HUMAN',
      botFill,
    });

    await prisma.matchmakingTicket.update({
      where: { id: player1.ticketId },
      data: { status: 'MATCHED', matchId },
    });

    if (!isBot) {
      await prisma.matchmakingTicket.update({
        where: { id: player2.ticketId },
        data: { status: 'MATCHED', matchId },
      });
    }

    const room = await matchMaker.createRoom('rps', {
      matchId,
      botFill,
      player1: {
        authToken: '',
        userId: player1.userId,
        displayName: player1.displayName,
        slot: 'PLAYER1',
        kind: 'HUMAN',
      },
      player2: {
        authToken: '',
        userId: isBot ? 'bot' : player2.userId,
        displayName: isBot ? 'Bot Opponent' : player2.displayName,
        slot: 'PLAYER2',
        kind: isBot ? 'BOT' : 'HUMAN',
      },
    });

    player1.client.send('match_found', {
      matchId,
      roomId: room.roomId,
      opponentKind: isBot ? 'BOT' : 'HUMAN',
      botFill,
    });

    if (!isBot && player2.client !== player1.client) {
      player2.client.send('match_found', {
        matchId,
        roomId: room.roomId,
        opponentKind: 'HUMAN',
        botFill: false,
      });
    }
  }
}
