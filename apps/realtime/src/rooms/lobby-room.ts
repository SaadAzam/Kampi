import { Room, Client, matchMaker } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { prisma } from '@kampi/database';
import { queueKeyString, type QueueKey, type Seat } from '@kampi/game-sdk/common';
import { assertDistinctPlayers } from '@kampi/game-sdk/server';
import { RPS_GAME_ID, RpsGameConfigSchema } from '@kampi/game-rps-core';
import { PENALTY_GAME_ID, PenaltyGameConfigSchema } from '@kampi/game-penalty';
import { authenticateToken } from '../auth.js';
import { economy } from '../config.js';
import { gameRegistry } from '../games/registry.js';
import { createMatchRecord } from '../games/match-factory.js';
import {
  deletePrivateSession,
  generateInviteCode,
  loadPrivateSession,
  savePrivateSession,
} from '../sessions/private-invite.js';

type QueueEntry = {
  ticketId: string;
  userId: string;
  displayName: string;
  client: Client;
  joinedAt: number;
  queueKey: QueueKey;
};

type JoinOptions = {
  authToken?: string;
  gameId?: string;
  gameVersion?: string;
  mode?: 'PUBLIC' | 'PRIVATE';
  stakeKey?: string;
  region?: string;
  action?: 'create_private' | 'join_private' | 'queue';
  inviteCode?: string;
};

function parseGameConfig(gameId: string, config: unknown) {
  if (gameId === PENALTY_GAME_ID) {
    return {
      entryFee: BigInt(PenaltyGameConfigSchema.parse(config).entryFee),
      winnerPayout: BigInt(PenaltyGameConfigSchema.parse(config).winnerPayout),
      bestOf: PenaltyGameConfigSchema.parse(config).regulationKicksPerPlayer * 2,
      botFillAfterMs: PenaltyGameConfigSchema.parse(config).botFillAfterMs,
    };
  }
  const parsed = RpsGameConfigSchema.parse(config);
  return {
    entryFee: BigInt(parsed.entryFee),
    winnerPayout: BigInt(parsed.winnerPayout),
    bestOf: parsed.bestOf,
    botFillAfterMs: parsed.botFillAfterMs,
  };
}

export class LobbyRoom extends Room {
  private queues = new Map<string, QueueEntry[]>();
  private botTimers = new Map<string, NodeJS.Timeout>();
  private clientMeta = new Map<
    string,
    { userId: string; displayName: string; queueKey: QueueKey; ticketId?: string }
  >();

  override onCreate() {
    this.setPatchRate(1000);

    this.onMessage('leave_queue', (client) => {
      client.leave();
    });

    this.onMessage('create_private', (client, message: { gameId?: string }) => {
      void this.handleCreatePrivate(client, message.gameId);
    });

    this.onMessage(
      'join_private',
      (client, message: { gameId?: string; inviteCode?: string }) => {
        void this.handleJoinPrivate(client, message.gameId, message.inviteCode);
      },
    );
  }

  override async onJoin(client: Client, options: JoinOptions) {
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

    const gameId = options.gameId ?? RPS_GAME_ID;
    if (!gameRegistry.has(gameId)) {
      client.send('error', { code: 'UNSUPPORTED_GAME', message: `Unknown game ${gameId}` });
      client.leave();
      return;
    }

    const queueKey: QueueKey = {
      gameId,
      gameVersion: options.gameVersion ?? '1.0.0',
      mode: options.mode ?? 'PUBLIC',
      stakeKey: options.stakeKey ?? 'default',
      region: options.region ?? 'global',
    };

    this.clientMeta.set(client.sessionId, {
      userId: player.userId,
      displayName: player.displayName,
      queueKey,
    });

    if (options.action === 'create_private' || options.mode === 'PRIVATE') {
      // Wait for create_private / join_private messages unless invite provided at join
      if (options.action === 'join_private' && options.inviteCode) {
        await this.handleJoinPrivate(client, gameId, options.inviteCode);
      } else if (options.action === 'create_private') {
        await this.handleCreatePrivate(client, gameId);
      }
      return;
    }

    await this.enqueuePublic(client, player.userId, player.displayName, queueKey);
  }

  private async enqueuePublic(
    client: Client,
    userId: string,
    displayName: string,
    queueKey: QueueKey,
  ) {
    const key = queueKeyString(queueKey);
    const queue = this.queues.get(key) ?? [];
    if ([...this.queues.values()].some((q) => q.some((e) => e.userId === userId))) {
      client.send('error', { code: 'ALREADY_QUEUED', message: 'Already in queue' });
      client.leave();
      return;
    }

    const ticketId = randomUUID();
    const entry: QueueEntry = {
      ticketId,
      userId,
      displayName,
      client,
      joinedAt: Date.now(),
      queueKey,
    };
    queue.push(entry);
    this.queues.set(key, queue);

    const meta = this.clientMeta.get(client.sessionId);
    if (meta) meta.ticketId = ticketId;

    const game = await prisma.game.findUniqueOrThrow({ where: { slug: queueKey.gameId } });
    await prisma.matchmakingTicket.create({
      data: {
        id: ticketId,
        userId,
        gameId: game.id,
        status: 'QUEUED',
      },
    });

    client.send('queue_joined', {
      ticketId,
      position: queue.length - 1,
    });

    this.tryMatchRealPlayers(key);

    const version = await prisma.gameVersion.findFirst({
      where: { gameId: game.id, isActive: true },
    });
    const config = parseGameConfig(queueKey.gameId, version?.config ?? {});
    const botDelay = config.botFillAfterMs || economy.botFillAfterMs;

    const registered = gameRegistry.get(queueKey.gameId);
    if (registered.manifest.botCapable) {
      const timer = setTimeout(() => {
        void this.fillWithBot(entry);
      }, botDelay);
      this.botTimers.set(ticketId, timer);
    }
  }

  private async handleCreatePrivate(client: Client, gameIdInput?: string) {
    const meta = this.clientMeta.get(client.sessionId);
    if (!meta) return;
    const gameId = gameIdInput ?? meta.queueKey.gameId;
    if (!gameRegistry.has(gameId)) {
      client.send('error', { code: 'UNSUPPORTED_GAME', message: `Unknown game ${gameId}` });
      return;
    }

    const code = generateInviteCode();
    const record = {
      code,
      gameId,
      gameVersion: meta.queueKey.gameVersion,
      stakeKey: meta.queueKey.stakeKey,
      creatorUserId: meta.userId,
      creatorDisplayName: meta.displayName,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    await savePrivateSession(this.presence, record);
    client.send('invite_created', {
      code,
      expiresAt: new Date(record.expiresAt).toISOString(),
    });
  }

  private async handleJoinPrivate(client: Client, gameIdInput?: string, inviteCode?: string) {
    const meta = this.clientMeta.get(client.sessionId);
    if (!meta || !inviteCode) {
      client.send('error', { code: 'SESSION_NOT_FOUND', message: 'Missing invite code' });
      return;
    }

    const session = await loadPrivateSession(this.presence, inviteCode);
    if (!session) {
      client.send('error', { code: 'SESSION_EXPIRED', message: 'Invite code expired or invalid' });
      return;
    }

    const gameId = gameIdInput ?? meta.queueKey.gameId;
    if (session.gameId !== gameId) {
      client.send('error', { code: 'QUEUE_MISMATCH', message: 'Invite is for a different game' });
      return;
    }
    if (session.creatorUserId === meta.userId) {
      client.send('error', { code: 'SAME_PLAYER', message: 'Creator cannot join both seats' });
      return;
    }

    try {
      assertDistinctPlayers([session.creatorUserId, meta.userId]);
    } catch (error) {
      client.send('error', {
        code: 'SAME_PLAYER',
        message: error instanceof Error ? error.message : 'Same player',
      });
      return;
    }

    const creatorClient = [...this.clients].find((c) => {
      const m = this.clientMeta.get(c.sessionId);
      return m?.userId === session.creatorUserId;
    });
    if (!creatorClient) {
      client.send('error', { code: 'SESSION_EXPIRED', message: 'Creator is no longer connected' });
      return;
    }

    await deletePrivateSession(this.presence, inviteCode);
    await this.createAndNotifyMatch(
      {
        ticketId: randomUUID(),
        userId: session.creatorUserId,
        displayName: session.creatorDisplayName,
        client: creatorClient,
        joinedAt: Date.now(),
        queueKey: { ...meta.queueKey, gameId, mode: 'PRIVATE' },
      },
      {
        ticketId: randomUUID(),
        userId: meta.userId,
        displayName: meta.displayName,
        client,
        joinedAt: Date.now(),
        queueKey: { ...meta.queueKey, gameId, mode: 'PRIVATE' },
      },
      false,
    );
  }

  override async onLeave(client: Client) {
    const meta = this.clientMeta.get(client.sessionId);
    this.clientMeta.delete(client.sessionId);
    if (!meta?.ticketId) return;

    for (const [key, queue] of this.queues) {
      const index = queue.findIndex((entry) => entry.client.sessionId === client.sessionId);
      if (index === -1) continue;
      const [removed] = queue.splice(index, 1);
      this.queues.set(key, queue);
      if (!removed) return;
      this.clearBotTimer(removed.ticketId);
      await prisma.matchmakingTicket.update({
        where: { id: removed.ticketId },
        data: { status: 'CANCELLED' },
      });
      return;
    }
  }

  private tryMatchRealPlayers(queueKeyStr: string) {
    const queue = this.queues.get(queueKeyStr) ?? [];
    while (queue.length >= 2) {
      const first = queue.shift();
      const second = queue.shift();
      if (!first || !second) break;
      this.clearBotTimer(first.ticketId);
      this.clearBotTimer(second.ticketId);
      void this.createAndNotifyMatch(first, second, false);
    }
    this.queues.set(queueKeyStr, queue);
  }

  private clearBotTimer(ticketId: string) {
    const timer = this.botTimers.get(ticketId);
    if (timer) {
      clearTimeout(timer);
      this.botTimers.delete(ticketId);
    }
  }

  private async fillWithBot(entry: QueueEntry) {
    const key = queueKeyString(entry.queueKey);
    const queue = this.queues.get(key) ?? [];
    if (!queue.some((q) => q.ticketId === entry.ticketId)) return;
    this.queues.set(
      key,
      queue.filter((q) => q.ticketId !== entry.ticketId),
    );
    this.clearBotTimer(entry.ticketId);

    const botEntry: QueueEntry = {
      ticketId: randomUUID(),
      userId: 'bot',
      displayName: 'Bot',
      client: entry.client,
      joinedAt: Date.now(),
      queueKey: entry.queueKey,
    };
    void this.createAndNotifyMatch(entry, botEntry, true);
  }

  private async createAndNotifyMatch(
    player1: QueueEntry,
    player2: QueueEntry,
    botFill: boolean,
  ) {
    const isBot = botFill || player2.userId === 'bot';
    const gameId = player1.queueKey.gameId;
    const registered = gameRegistry.get(gameId);

    const game = await prisma.game.findUniqueOrThrow({ where: { slug: gameId } });
    const version = await prisma.gameVersion.findFirst({
      where: { gameId: game.id, isActive: true },
    });
    const config = parseGameConfig(gameId, version?.config ?? {});

    if (!isBot) {
      try {
        assertDistinctPlayers([player1.userId, player2.userId]);
      } catch {
        player1.client.send('error', {
          code: 'SAME_PLAYER',
          message: 'Cannot match the same player twice',
        });
        return;
      }
    }

    const { matchId } = await createMatchRecord({
      gameSlug: gameId,
      entryFee: config.entryFee,
      winnerPayout: config.winnerPayout,
      bestOf: config.bestOf,
      botFill,
      playerA: {
        userId: player1.userId,
        displayName: player1.displayName,
        kind: 'HUMAN',
      },
      playerB: {
        userId: isBot ? 'bot' : player2.userId,
        displayName: isBot ? 'Bot Opponent' : player2.displayName,
        kind: isBot ? 'BOT' : 'HUMAN',
      },
      metadata: {
        gameVersion: player1.queueKey.gameVersion,
        stakeKey: player1.queueKey.stakeKey,
        mode: player1.queueKey.mode,
      },
    });

    await prisma.matchmakingTicket.updateMany({
      where: { id: { in: [player1.ticketId, ...(isBot ? [] : [player2.ticketId])] } },
      data: { status: 'MATCHED', matchId },
    });

    const seatA: Seat = 'A';
    const seatB: Seat = 'B';

    const room = await matchMaker.createRoom(registered.roomName, {
      matchId,
      botFill,
      gameId,
      playerA: {
        userId: player1.userId,
        displayName: player1.displayName,
        seat: seatA,
        kind: 'HUMAN',
      },
      playerB: {
        userId: isBot ? 'bot' : player2.userId,
        displayName: isBot ? 'Bot Opponent' : player2.displayName,
        seat: seatB,
        kind: isBot ? 'BOT' : 'HUMAN',
      },
      economy: {
        entryFee: config.entryFee.toString(),
        winnerPayout: config.winnerPayout.toString(),
      },
      versionConfig: version?.config ?? {},
    });

    player1.client.send('match_found', {
      matchId,
      roomId: room.roomId,
      seat: seatA,
      opponentKind: isBot ? 'BOT' : 'HUMAN',
      botFill,
      gameId,
    });

    if (!isBot && player2.client !== player1.client) {
      player2.client.send('match_found', {
        matchId,
        roomId: room.roomId,
        seat: seatB,
        opponentKind: 'HUMAN',
        botFill: false,
        gameId,
      });
    }
  }
}
