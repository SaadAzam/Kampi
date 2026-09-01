import Phaser from 'phaser';
import { Client, Room } from 'colyseus.js';
import type { RpsMatchSnapshot, RpsChoice } from '@kampi/contracts';
import { GameEmbedClient } from '@kampi/game-sdk';
import { runtimeConfig } from '../config.js';

type UiState = {
  status: string;
  connection: string;
  queue: string;
  opponent: string;
  score: string;
  timer: string;
  result: string;
};

export class GameScene extends Phaser.Scene {
  private client?: Client;
  private lobbyRoom?: Room;
  private gameRoom?: Room;
  private snapshot?: RpsMatchSnapshot;
  private reconnectionToken?: string;
  private ui!: UiState;
  private uiTexts: Record<keyof UiState, Phaser.GameObjects.Text> = {} as Record<
    keyof UiState,
    Phaser.GameObjects.Text
  >;
  private embed?: GameEmbedClient;

  constructor() {
    super('GameScene');
  }

  create() {
    this.ui = {
      status: 'Connecting…',
      connection: 'offline',
      queue: '',
      opponent: '',
      score: '0 - 0',
      timer: '',
      result: '',
    };

    this.drawBackground();
    this.createUi();
    this.createChoiceButtons();
    this.setupEmbed();
    void this.connect();
  }

  private drawBackground() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x1e293b, 1);
    graphics.fillRoundedRect(20, 20, this.scale.width - 40, this.scale.height - 40, 16);
  }

  private createUi() {
    const labels: Array<[keyof UiState, number]> = [
      ['status', 60],
      ['connection', 90],
      ['queue', 120],
      ['opponent', 150],
      ['score', 180],
      ['timer', 210],
      ['result', 240],
    ];

    for (const [key, y] of labels) {
      this.uiTexts[key] = this.add
        .text(32, y, '', {
          fontFamily: 'Arial, sans-serif',
          fontSize: '16px',
          color: '#e2e8f0',
          wordWrap: { width: this.scale.width - 64 },
        })
        .setDepth(10);
    }
    this.refreshUi();
  }

  private createChoiceButtons() {
    const choices: RpsChoice[] = ['ROCK', 'PAPER', 'SCISSORS'];
    const startY = this.scale.height - 180;
    choices.forEach((choice, index) => {
      const x = 60 + index * Math.max(100, (this.scale.width - 120) / 3);
      const btn = this.add
        .rectangle(x, startY, 90, 56, 0x334155)
        .setInteractive({ useHandCursor: true })
        .setStrokeStyle(2, 0x64748b)
        .setDepth(10);
      this.add
        .text(x, startY, choice[0] ?? '?', {
          fontSize: '24px',
          color: '#f8fafc',
        })
        .setOrigin(0.5)
        .setDepth(11);

      btn.on('pointerdown', () => this.submitChoice(choice));
    });

    const queueBtn = this.add
      .rectangle(this.scale.width / 2, startY - 80, 220, 48, 0x2563eb)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);
    this.add
      .text(this.scale.width / 2, startY - 80, 'Find Match', {
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(11);
    queueBtn.on('pointerdown', () => void this.joinQueue());
  }

  private setupEmbed() {
    if (window.parent === window) return;
    this.embed = new GameEmbedClient({
      iframe: window.frameElement as HTMLIFrameElement,
      allowedOrigins: ['http://localhost:3000', 'http://localhost:5173'],
      onMessage: (message) => {
        if (message.type === 'session') {
          runtimeConfig.authToken = message.authToken;
        }
      },
    });
    this.embed.notifyReady('rock-paper-scissors');
  }

  private async connect() {
    this.ui.connection = 'connecting';
    this.refreshUi();
    this.client = new Client(runtimeConfig.realtimeUrl);

    try {
      this.ui.connection = 'online';
      this.ui.status = 'Ready — tap Find Match';
      this.refreshUi();
    } catch {
      this.ui.connection = 'error';
      this.ui.status = 'Failed to connect to realtime server';
      this.refreshUi();
    }
  }

  private async joinQueue() {
    if (!this.client) return;
    this.ui.queue = 'Joining queue…';
    this.ui.status = 'Searching for opponent';
    this.refreshUi();

    this.lobbyRoom = await this.client.joinOrCreate('lobby', {
      authToken: runtimeConfig.authToken,
    });

    this.lobbyRoom.onMessage('queue_joined', (payload: { ticketId: string; position: number }) => {
      this.ui.queue = `Queued (#${payload.position + 1}) — real players first`;
      this.refreshUi();
    });

    this.lobbyRoom.onMessage(
      'match_found',
      async (payload: {
        matchId: string;
        roomId: string;
        opponentKind: 'HUMAN' | 'BOT';
        botFill: boolean;
      }) => {
        this.ui.queue = payload.botFill ? 'Bot joined — match starting' : 'Opponent found!';
        this.ui.opponent = payload.opponentKind === 'BOT' ? 'Bot Opponent' : 'Human Opponent';
        this.refreshUi();
        await this.joinGameRoom(payload.roomId, payload.matchId);
        this.embed?.postToHost({
          type: 'match_started',
          matchId: payload.matchId,
          gameSlug: 'rock-paper-scissors',
        });
      },
    );

    this.lobbyRoom.onMessage('error', (payload: { message: string }) => {
      this.ui.status = payload.message;
      this.refreshUi();
    });
  }

  private async joinGameRoom(roomId: string, matchId: string) {
    if (!this.client) return;

    this.gameRoom = await this.client.joinById(roomId, {
      authToken: runtimeConfig.authToken,
      userId: 'auto',
      displayName: 'Player',
      slot: 'PLAYER1',
      kind: 'HUMAN',
      matchId,
    });

    this.reconnectionToken = this.gameRoom.reconnectionToken;
    this.ui.status = 'Match active';
    this.refreshUi();

    this.gameRoom.onMessage('snapshot', (snapshot: RpsMatchSnapshot) => {
      this.snapshot = snapshot;
      this.renderSnapshot(snapshot);
    });

    this.gameRoom.onMessage(
      'match_completed',
      (payload: { winnerSlot: string; payout: string | null }) => {
        this.ui.result = `Match complete — winner: ${payload.winnerSlot}`;
        this.refreshUi();
        this.embed?.postToHost({
          type: 'match_completed',
          matchId,
          result: payload.winnerSlot === 'PLAYER1' ? 'WIN' : 'LOSS',
          payout: payload.payout,
        });
      },
    );

    this.gameRoom.onLeave((code) => {
      if (code !== 1000 && this.reconnectionToken) {
        void this.tryReconnect();
      }
    });
  }

  private async tryReconnect() {
    if (!this.client || !this.reconnectionToken) return;
    this.ui.connection = 'reconnecting';
    this.refreshUi();
    try {
      this.gameRoom = await this.client.reconnect(this.reconnectionToken);
      this.ui.connection = 'online';
      this.ui.status = 'Reconnected';
      this.refreshUi();
    } catch {
      this.ui.connection = 'error';
      this.ui.status = 'Reconnection failed';
      this.refreshUi();
    }
  }

  private submitChoice(choice: RpsChoice) {
    if (!this.gameRoom || !this.snapshot || this.snapshot.status !== 'ACTIVE') return;
    this.gameRoom.send('submit_choice', { choice });
    this.ui.status = `Locked: ${choice}`;
    this.refreshUi();
  }

  private renderSnapshot(snapshot: RpsMatchSnapshot) {
    const me = snapshot.players.find((p) => p.slot === 'PLAYER1');
    const opp = snapshot.players.find((p) => p.slot === 'PLAYER2');
    this.ui.score = `${me?.score ?? 0} - ${opp?.score ?? 0}`;
    this.ui.connection = me?.connected ? 'online' : 'reconnecting';
    if (snapshot.roundDeadlineMs) {
      const remaining = Math.max(0, snapshot.roundDeadlineMs - Date.now());
      this.ui.timer = `Round ${snapshot.currentRound} — ${Math.ceil(remaining / 1000)}s`;
    }
    if (snapshot.status === 'FINISHED') {
      this.ui.result = `Finished — winner ${snapshot.winnerSlot ?? 'none'}`;
    }
    if (snapshot.status === 'ABORTED') {
      this.ui.result = `Aborted: ${snapshot.abortReason ?? 'unknown'}`;
    }
    this.refreshUi();
  }

  private refreshUi() {
    for (const key of Object.keys(this.ui) as Array<keyof UiState>) {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      this.uiTexts[key].setText(`${label}: ${this.ui[key]}`);
    }
  }
}
