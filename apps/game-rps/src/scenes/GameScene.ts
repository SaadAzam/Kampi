import Phaser from 'phaser';
import type { RpsMatchSnapshot, RpsChoice } from '@kampi/contracts';
import { GameSessionClient } from '@kampi/game-sdk/client';
import { GameEmbedClient } from '@kampi/game-sdk/embed';
import { RPS_GAME_ID } from '@kampi/game-rps-core';
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
  private session?: GameSessionClient;
  private snapshot?: RpsMatchSnapshot;
  private mySlot: 'PLAYER1' | 'PLAYER2' = 'PLAYER1';
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
      status: 'Ready — tap Find Match',
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
    this.ui.connection = 'online';
    this.refreshUi();
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
    const parentOrigin = import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:3000';
    this.embed = new GameEmbedClient({
      parentOrigin,
      allowedOrigins: [parentOrigin],
      onMessage: (message) => {
        if (message.type === 'session') {
          runtimeConfig.authToken = message.authToken;
        }
      },
    });
    this.embed.notifyReady(RPS_GAME_ID);
  }

  private ensureSession(): GameSessionClient {
    if (!this.session) {
      this.session = new GameSessionClient({
        realtimeUrl: runtimeConfig.realtimeUrl,
        authToken: runtimeConfig.authToken,
        gameId: RPS_GAME_ID,
      });
      this.session.on('status', (status) => {
        this.ui.connection = status === 'reconnecting' ? 'reconnecting' : 'online';
        this.refreshUi();
      });
      this.session.on('queue_joined', () => {
        this.ui.queue = 'Joining matchmaking queue…';
        this.ui.status = 'Searching for opponent';
        this.refreshUi();
      });
      this.session.on('match_found', (payload) => {
        this.mySlot = payload.seat === 'A' ? 'PLAYER1' : 'PLAYER2';
        this.ui.queue = payload.botFill ? 'Bot joined — match starting' : 'Opponent found!';
        this.ui.opponent = payload.opponentKind === 'BOT' ? 'Bot Opponent' : 'Human Opponent';
        this.refreshUi();
        this.embed?.postToHost({
          type: 'match_started',
          matchId: payload.matchId,
          gameSlug: RPS_GAME_ID,
        });
      });
      this.session.on('snapshot', (payload) => {
        this.snapshot = payload as RpsMatchSnapshot;
        this.renderSnapshot(this.snapshot);
      });
      this.session.on('match_completed', (payload) => {
        const data = payload as { winnerSlot: string; payout: string | null };
        this.ui.result = `Match complete — winner: ${data.winnerSlot}`;
        this.refreshUi();
        this.embed?.postToHost({
          type: 'match_completed',
          matchId: this.snapshot?.matchId ?? '00000000-0000-4000-8000-000000000000',
          result: data.winnerSlot === this.mySlot ? 'WIN' : 'LOSS',
          payout: data.payout,
        });
      });
      this.session.on('error', (payload) => {
        this.ui.status = payload.message;
        this.refreshUi();
      });
    }
    return this.session;
  }

  private async joinQueue() {
    const session = this.ensureSession();
    this.ui.queue = 'Joining matchmaking queue…';
    this.ui.status = 'Searching for opponent';
    this.refreshUi();
    await session.joinQueue();
  }

  private submitChoice(choice: RpsChoice) {
    if (!this.session || !this.snapshot || this.snapshot.status !== 'ACTIVE') return;
    this.session.sendAction('submit_choice', {
      commandId: crypto.randomUUID(),
      choice,
    });
    this.ui.status = `Locked: ${choice}`;
    this.refreshUi();
  }

  private renderSnapshot(snapshot: RpsMatchSnapshot) {
    const me = snapshot.players.find((p) => p.slot === this.mySlot);
    const opp = snapshot.players.find((p) => p.slot !== this.mySlot);
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
