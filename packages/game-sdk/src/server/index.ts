import type { GameManifest } from '../common/index.js';
import { GameManifestSchema, SdkError, queueKeyString, type QueueKey } from '../common/index.js';
import { z } from 'zod';

export type RegisteredGame = {
  manifest: GameManifest;
  /** Colyseus room class name / define key */
  roomName: string;
};

export class GameRegistry {
  private readonly games = new Map<string, RegisteredGame>();

  register(manifestInput: z.input<typeof GameManifestSchema>): void {
    const manifest = GameManifestSchema.parse(manifestInput);
    if (this.games.has(manifest.gameId)) {
      throw new SdkError('UNSUPPORTED_GAME', `Duplicate game registration: ${manifest.gameId}`);
    }
    this.games.set(manifest.gameId, { manifest, roomName: manifest.roomName });
  }

  get(gameId: string): RegisteredGame {
    const game = this.games.get(gameId);
    if (!game) {
      throw new SdkError('UNSUPPORTED_GAME', `Unknown game: ${gameId}`);
    }
    return game;
  }

  has(gameId: string): boolean {
    return this.games.has(gameId);
  }

  list(): RegisteredGame[] {
    return [...this.games.values()];
  }

  assertProtocol(gameId: string, protocolVersion: string): void {
    const game = this.get(gameId);
    if (game.manifest.protocolVersion !== protocolVersion) {
      throw new SdkError(
        'UNSUPPORTED_PROTOCOL',
        `Expected protocol ${game.manifest.protocolVersion}, got ${protocolVersion}`,
      );
    }
  }
}

export type SettlementPorts = {
  deductEntryFees(input: {
    matchId: string;
    entryFee: bigint;
    players: Array<{ userId: string; slot: number; entryFeeKey: string }>;
  }): Promise<void>;
  finalizeMatchPayout(input: {
    matchId: string;
    winnerUserId: string;
    payout: bigint;
    payoutLedgerKey: string;
  }): Promise<{ paid: boolean }>;
  refundAbortedMatch(input: {
    matchId: string;
    players: Array<{ userId: string; entryFeeKey: string }>;
    entryFee: bigint;
    abortRefundKey: string;
  }): Promise<void>;
};

/** Exactly-once settlement coordinator — wraps domain ports with local finalization guard. */
export class SettlementCoordinator {
  private finalized = false;
  private settling = false;

  constructor(private readonly ports: SettlementPorts) {}

  get isFinalized(): boolean {
    return this.finalized;
  }

  async deductEntries(input: Parameters<SettlementPorts['deductEntryFees']>[0]): Promise<void> {
    await this.ports.deductEntryFees(input);
  }

  async payWinner(input: Parameters<SettlementPorts['finalizeMatchPayout']>[0]): Promise<boolean> {
    if (this.finalized || this.settling) return false;
    this.settling = true;
    try {
      const result = await this.ports.finalizeMatchPayout(input);
      this.finalized = true;
      return result.paid;
    } finally {
      this.settling = false;
    }
  }

  async abortRefund(input: Parameters<SettlementPorts['refundAbortedMatch']>[0]): Promise<void> {
    if (this.finalized || this.settling) return;
    this.settling = true;
    try {
      await this.ports.refundAbortedMatch(input);
      this.finalized = true;
    } finally {
      this.settling = false;
    }
  }

  markFinalized(): void {
    this.finalized = true;
  }
}

export type CommandGuardOptions = {
  maxActionsPerWindow?: number;
  windowMs?: number;
};

export class CommandGuard {
  private readonly seenCommandIds = new Set<string>();
  private readonly timestamps: number[] = [];

  constructor(private readonly options: CommandGuardOptions = {}) {}

  /** Returns true if this is a duplicate idempotent retry (already applied). */
  checkIdempotency(commandId: string): 'new' | 'duplicate' {
    if (this.seenCommandIds.has(commandId)) return 'duplicate';
    if (this.seenCommandIds.size >= 1024) {
      const oldest = this.seenCommandIds.values().next().value;
      if (oldest) this.seenCommandIds.delete(oldest);
    }
    this.seenCommandIds.add(commandId);
    return 'new';
  }

  assertRateLimit(now: number): void {
    const windowMs = this.options.windowMs ?? 2000;
    const max = this.options.maxActionsPerWindow ?? 8;
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? 0) < now - windowMs) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= max) {
      throw new SdkError('RATE_LIMITED', 'Too many actions');
    }
    this.timestamps.push(now);
  }
}

export type DeadlineHandle = {
  clear(): void;
};

export class DeadlineScheduler {
  private timers = new Set<ReturnType<typeof setTimeout>>();

  schedule(delayMs: number, callback: () => void): DeadlineHandle {
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        callback();
      },
      Math.max(0, delayMs),
    );
    this.timers.add(timer);
    return {
      clear: () => {
        clearTimeout(timer);
        this.timers.delete(timer);
      },
    };
  }

  clearAll(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

export function assertDistinctPlayers(userIds: string[]): void {
  const humans = userIds.filter((id) => id && id !== 'bot');
  if (new Set(humans).size !== humans.length) {
    throw new SdkError('SAME_PLAYER', 'The same player cannot occupy both seats');
  }
}

export { queueKeyString };
export type { QueueKey, GameManifest };
