import { z } from 'zod';
import {
  GAME_SDK_PROTOCOL_VERSION,
  QueueKeySchema,
  SeatSchema,
  SdkError,
  type QueueKey,
  type Seat,
} from '../common/index.js';

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'queued' | 'in_match' | 'reconnecting' | 'error';

export type MatchFoundPayload = {
  matchId: string;
  roomId: string;
  seat: Seat;
  opponentKind: 'HUMAN' | 'BOT';
  botFill: boolean;
  gameId: string;
  reconnectionToken?: string;
};

export type GameClientOptions = {
  realtimeUrl: string;
  authToken: string;
  gameId: string;
  gameVersion?: string;
  mode?: 'PUBLIC' | 'PRIVATE';
  stakeKey?: string;
  region?: string;
  /** Injected Colyseus Client for tests */
  clientFactory?: (url: string) => ColyseusLikeClient;
};

export type ColyseusLikeRoom = {
  roomId: string;
  reconnectionToken?: string;
  sessionId: string;
  send(type: string, message?: unknown): void;
  leave(consented?: boolean): void;
  onMessage(type: string, callback: (payload: unknown) => void): void;
  onLeave(callback: (code: number) => void): void;
  onError?(callback: (code: number, message?: string) => void): void;
};

export type ColyseusLikeClient = {
  joinOrCreate(roomName: string, options?: Record<string, unknown>): Promise<ColyseusLikeRoom>;
  joinById(roomId: string, options?: Record<string, unknown>): Promise<ColyseusLikeRoom>;
  reconnect(reconnectionToken: string): Promise<ColyseusLikeRoom>;
};

const JoinOptionsSchema = QueueKeySchema.extend({
  authToken: z.string().min(1),
});

type ListenerMap = {
  status: ConnectionStatus;
  queue_joined: { ticketId: string; position: number };
  match_found: MatchFoundPayload;
  snapshot: unknown;
  match_completed: unknown;
  private_ack: unknown;
  error: { code: string; message: string };
  invite_created: { code: string; expiresAt: string };
};

type Listener<K extends keyof ListenerMap> = (payload: ListenerMap[K]) => void;

/**
 * Browser-safe session client. Does not import Node or database code.
 * Uses Colyseus.js when available; tests inject a fake clientFactory.
 */
export class GameSessionClient {
  private client?: ColyseusLikeClient;
  private lobby?: ColyseusLikeRoom;
  private match?: ColyseusLikeRoom;
  private status: ConnectionStatus = 'disconnected';
  private reconnectionToken?: string;
  private readonly listeners = new Map<keyof ListenerMap, Set<(payload: never) => void>>();
  private destroyed = false;
  private matchFinished = false;

  constructor(private readonly options: GameClientOptions) {}

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  getReconnectionToken(): string | undefined {
    return this.reconnectionToken;
  }

  on<K extends keyof ListenerMap>(event: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (payload: never) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (payload: never) => void);
  }

  private emit<K extends keyof ListenerMap>(event: K, payload: ListenerMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      listener(payload as never);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit('status', status);
  }

  async connect(): Promise<void> {
    if (this.destroyed) throw new SdkError('INTERNAL', 'Client destroyed');
    this.setStatus('connecting');
    const { Client } = await import('colyseus.js');
    this.client =
      this.options.clientFactory?.(this.options.realtimeUrl) ??
      (new Client(this.options.realtimeUrl) as unknown as ColyseusLikeClient);
    this.setStatus('connected');
  }

  private queueKey(): QueueKey {
    return QueueKeySchema.parse({
      gameId: this.options.gameId,
      gameVersion: this.options.gameVersion ?? '1.0.0',
      mode: this.options.mode ?? 'PUBLIC',
      stakeKey: this.options.stakeKey ?? 'default',
      region: this.options.region ?? 'global',
    });
  }

  async joinQueue(): Promise<void> {
    if (!this.client) await this.connect();
    if (!this.client) throw new SdkError('INTERNAL', 'Client not connected');

    const options = JoinOptionsSchema.parse({
      ...this.queueKey(),
      authToken: this.options.authToken,
    });

    this.lobby = await this.client.joinOrCreate('lobby', options);
    this.wireLobby(this.lobby);
  }

  async createPrivateSession(): Promise<void> {
    if (!this.client) await this.connect();
    if (!this.client) throw new SdkError('INTERNAL', 'Client not connected');

    this.lobby = await this.client.joinOrCreate('lobby', {
      ...this.queueKey(),
      mode: 'PRIVATE',
      authToken: this.options.authToken,
      action: 'create_private',
    });
    this.wireLobby(this.lobby);
  }

  async joinPrivateSession(inviteCode: string): Promise<void> {
    if (!this.client) await this.connect();
    if (!this.client) throw new SdkError('INTERNAL', 'Client not connected');

    this.lobby = await this.client.joinOrCreate('lobby', {
      ...this.queueKey(),
      mode: 'PRIVATE',
      authToken: this.options.authToken,
      action: 'join_private',
      inviteCode,
    });
    this.wireLobby(this.lobby);
  }

  private wireLobby(room: ColyseusLikeRoom): void {
    room.onMessage('queue_joined', (payload) => {
      this.setStatus('queued');
      this.emit('queue_joined', payload as ListenerMap['queue_joined']);
    });
    room.onMessage('match_found', (payload) => {
      void this.handleMatchFound(payload as MatchFoundPayload).catch(() => {
        this.setStatus('error');
        this.emit('error', {
          code: 'INTERNAL',
          message: 'Could not join match. Please try again.',
        });
      });
    });
    room.onMessage('invite_created', (payload) => {
      this.emit('invite_created', payload as ListenerMap['invite_created']);
    });
    room.onMessage('error', (payload) => {
      this.setStatus('error');
      this.emit('error', payload as ListenerMap['error']);
    });
  }

  private async handleMatchFound(payload: MatchFoundPayload): Promise<void> {
    this.matchFinished = false;
    this.emit('match_found', payload);
    if (!this.client) return;
    this.match = await this.client.joinById(payload.roomId, {
      authToken: this.options.authToken,
      seat: payload.seat,
      matchId: payload.matchId,
      gameId: payload.gameId,
    });
    this.reconnectionToken = this.match.reconnectionToken;
    this.setStatus('in_match');
    this.wireMatch(this.match);
    this.match.send('request_snapshot');
    try {
      this.lobby?.leave(true);
    } catch {
      // lobby may already be closed
    }
    this.lobby = undefined;
  }

  private wireMatch(room: ColyseusLikeRoom): void {
    room.onMessage('snapshot', (payload) => {
      const state = payload as { phase?: string; status?: string } | null;
      if (state && ['FINISHED', 'ABORTED'].includes(state.phase ?? state.status ?? ''))
        this.matchFinished = true;
      this.emit('snapshot', payload);
    });
    room.onMessage('match_completed', (payload) => {
      this.matchFinished = true;
      this.emit('match_completed', payload);
    });
    room.onMessage('private_ack', (payload) => this.emit('private_ack', payload));
    room.onMessage('error', (payload) => this.emit('error', payload as ListenerMap['error']));
    room.onLeave((code) => {
      if (this.destroyed || this.match !== room) return;
      if (!this.matchFinished && code !== 1000 && this.reconnectionToken) {
        void this.reconnect();
      } else {
        this.setStatus('disconnected');
      }
    });
  }

  async reconnect(): Promise<void> {
    if (!this.client || !this.reconnectionToken) {
      this.setStatus('error');
      return;
    }
    this.setStatus('reconnecting');
    for (let attempt = 0; attempt < 9 && !this.destroyed; attempt++) {
      try {
        const room = await this.client.reconnect(this.reconnectionToken);
        if (this.destroyed) {
          room.leave(true);
          return;
        }
        this.match = room;
        this.reconnectionToken = room.reconnectionToken ?? this.reconnectionToken;
        this.wireMatch(room);
        this.setStatus('in_match');
        room.send('request_snapshot');
        return;
      } catch {
        // The server may still be detecting the closed socket. Retry within its grace period.
        if (attempt < 8)
          await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** attempt, 2000)));
      }
    }
    if (!this.destroyed) {
      this.setStatus('error');
      this.emit('error', {
        code: 'INTERNAL',
        message: 'Reconnection failed. Return to the lobby to try again.',
      });
    }
  }

  sendAction(type: string, payload: Record<string, unknown>): void {
    if (!this.match) throw new SdkError('WRONG_PHASE', 'Not in a match');
    this.match.send(type, {
      protocolVersion: GAME_SDK_PROTOCOL_VERSION,
      gameId: this.options.gameId,
      ...payload,
    });
  }

  leaveQueue(): void {
    this.lobby?.leave(true);
    this.lobby = undefined;
    if (this.status === 'queued') this.setStatus('connected');
  }

  leaveMatch(): void {
    const room = this.match;
    this.match = undefined;
    this.reconnectionToken = undefined;
    room?.leave(true);
    this.setStatus('connected');
  }

  destroy(): void {
    this.destroyed = true;
    this.leaveQueue();
    this.leaveMatch();
    this.listeners.clear();
    this.setStatus('disconnected');
  }
}

export { SeatSchema };
export type { Seat, QueueKey };
